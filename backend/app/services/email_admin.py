"""
Everything an administrator can do about email from the Configuration screen:
see whether it is working, pause it, send a test, reword the emails, preview them,
look at what was sent and retry what failed.

Whether email is set up at all (the sending domain and the connection to Azure) is
decided when the stack is provisioned (deploy/provision.ps1), because creating and
verifying the domain needs Azure rights the application deliberately does not have.
"""

import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError, NotFoundError
from app.i18n.documents import document_language
from app.i18n.emails import GROUPS, TEXT, WordingError, check_text, compose, is_subject, line, placeholders_of
from app.languages import SUPPORTED_LANGUAGES
from app.models import EmailMessage, EmailSettings, EmailTextOverride, User
from app.services import email_outbox
from app.services.audit import audit_log
from app.services.configuration import get_configuration
from app.services.email_content import BUILDERS, SAMPLES, load_wording
from app.i18n.emails import Wording

_ADDRESS = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _wording_error(error: WordingError) -> AppError:
    return AppError(f"email.{error.code}", str(error), **error.params)


# --- status and settings -----------------------------------------------------------------------


def status(db: Session) -> dict:
    settings = db.get(EmailSettings, 1)
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    def count(*conditions):
        return db.scalar(select(func.count()).select_from(EmailMessage).where(*conditions)) or 0

    oldest_pending = db.scalar(select(func.min(EmailMessage.created_at)).where(EmailMessage.status == "PENDING"))
    last_sent = db.scalar(select(func.max(EmailMessage.sent_at)).where(EmailMessage.status == "SENT"))
    sender = email_outbox._thread

    return {
        "set_up": email_outbox.email_enabled(),
        "paused": settings is not None and not settings.enabled,
        "from_address": __import__("os").getenv("EMAIL_FROM_ADDRESS") or None,
        "worker_running": bool(sender is not None and sender.is_alive()),
        "pending": count(EmailMessage.status == "PENDING"),
        "failed": count(EmailMessage.status == "FAILED"),
        "sent_last_7_days": count(EmailMessage.status == "SENT", EmailMessage.sent_at >= week_ago),
        "oldest_pending_at": oldest_pending,
        "last_sent_at": last_sent,
        "language": document_language(get_configuration(db).document_language),
    }


def set_paused(db: Session, actor: User, paused: bool) -> None:
    settings = db.get(EmailSettings, 1)

    if settings is None:
        settings = EmailSettings(id=1, enabled=True)
        db.add(settings)

    if settings.enabled == (not paused):
        return

    settings.enabled = not paused
    settings.updated_at = datetime.now(timezone.utc)

    audit_log(
        db,
        user=actor,
        action="email.paused" if paused else "email.resumed",
        entity_type="email",
        entity_id=None,
        metadata={},
    )

    db.commit()


# --- wording -----------------------------------------------------------------------------------


def texts_catalog(db: Session) -> dict:
    """Every line of every email: its built-in wording in each language, the
    business's own wording where it has written some, and the {names} it may use."""

    overrides = {
        (row.key, row.language): row.text for row in db.scalars(select(EmailTextOverride))
    }

    groups = []

    for group, keys in GROUPS.items():
        lines = []

        for key in keys:
            lines.append(
                {
                    "key": key,
                    "is_subject": is_subject(key),
                    "placeholders": list(placeholders_of(key)),
                    "defaults": {language: TEXT[language][key] for language in SUPPORTED_LANGUAGES},
                    "overrides": {
                        language: overrides[(key, language)]
                        for language in SUPPORTED_LANGUAGES
                        if (key, language) in overrides
                    },
                }
            )

        groups.append({"id": group, "lines": lines})

    return {
        "languages": list(SUPPORTED_LANGUAGES),
        "sent_in": document_language(get_configuration(db).document_language),
        "groups": groups,
    }


def _check_language(language: str) -> str:
    if language not in SUPPORTED_LANGUAGES:
        raise AppError("email.unknown_language", "That language is not supported.")

    return language


def save_text(db: Session, actor: User, language: str, key: str, text: str) -> None:
    _check_language(language)

    try:
        # An empty text is allowed for everything but a subject: it leaves the line out.
        text = check_text(key, text)
    except WordingError as error:
        raise _wording_error(error)

    row = db.get(EmailTextOverride, (key, language))

    if row is not None and row.text == text:
        return

    if row is None:
        row = EmailTextOverride(key=key, language=language, text=text)
        db.add(row)

    row.text = text
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="email.text_changed",
        entity_type="email",
        entity_id=None,
        metadata={"line": key, "language": language, "left_out": text == ""},
    )

    db.commit()


def reset_text(db: Session, actor: User, language: str, key: str) -> None:
    _check_language(language)

    row = db.get(EmailTextOverride, (key, language))

    if row is None:
        return

    db.delete(row)

    audit_log(
        db,
        user=actor,
        action="email.text_reset",
        entity_type="email",
        entity_id=None,
        metadata={"line": key, "language": language},
    )

    db.commit()


def preview(db: Session, template: str, language: str, edits: dict[str, str]) -> dict:
    """The email as it would read with `edits` (lines not saved yet) on top of what
    is saved, filled in with sample values."""

    _check_language(language)

    if template not in BUILDERS:
        raise AppError("email.unknown_template", "There is no such email.")

    overrides = {
        (row.key, row.language): row.text for row in db.scalars(select(EmailTextOverride))
    }

    for key, text in edits.items():
        try:
            overrides[(key, language)] = check_text(key, text)
        except WordingError as error:
            raise _wording_error(error)

    subject, paragraphs = BUILDERS[template](Wording(overrides), language, SAMPLES[template])
    body, _ = compose(paragraphs)

    return {"subject": subject, "body": body}


# --- test send ---------------------------------------------------------------------------------


def send_test(db: Session, actor: User, to_address: str | None) -> dict:
    """Sends a short email right now, straight through Azure, and reports what
    happened, so a problem with the setup shows here instead of silently on a
    renter's booking. Nothing is queued or recorded in the outbox."""

    address = (to_address or actor.email or "").strip()

    if not _ADDRESS.match(address):
        raise AppError("email.test_address_invalid", "Enter a valid email address.")

    if not email_outbox.email_enabled():
        raise AppError("email.not_set_up", "Email is not set up on this stack yet.")

    configuration = get_configuration(db)
    language = document_language(configuration.document_language)
    body, html = compose(
        [
            line(language, "test.body", business=configuration.business_name),
        ]
    )
    message = SimpleNamespace(
        to_address=address,
        to_name=None,
        reply_to=configuration.email,
        subject=line(language, "test.subject", business=configuration.business_name),
        body_text=body,
        body_html=html,
    )

    sender = email_outbox.configured_sender()
    outcome = {"sent": True, "error": None, "to": address}

    try:
        sender.send(message, None)
    except Exception as error:  # noqa: BLE001 - whatever Azure says is what the administrator needs to see
        outcome = {"sent": False, "error": str(error)[:500], "to": address}

    audit_log(
        db,
        user=actor,
        action="email.test_sent" if outcome["sent"] else "email.test_failed",
        entity_type="email",
        entity_id=None,
        metadata={"sent": outcome["sent"]},
    )
    db.commit()

    return outcome


# --- what was sent -----------------------------------------------------------------------------


def list_messages(db: Session, *, limit: int = 50, only: str | None = None) -> list[EmailMessage]:
    query = select(EmailMessage).order_by(EmailMessage.created_at.desc()).limit(limit)

    if only in ("PENDING", "SENT", "FAILED"):
        query = query.where(EmailMessage.status == only)

    return list(db.scalars(query))


def retry_message(db: Session, actor: User, message_id: UUID) -> EmailMessage:
    """Puts a message that was given up on back in the queue for another six tries."""

    message = db.scalar(select(EmailMessage).where(EmailMessage.id == message_id).with_for_update())

    if message is None:
        raise NotFoundError("email.message_not_found", "That email was not found.")

    if message.status != "FAILED":
        raise AppError("email.only_failed_can_be_retried", "Only an email that failed can be sent again.")

    message.status = "PENDING"
    message.attempts = 0
    message.next_attempt_at = datetime.now(timezone.utc)

    audit_log(
        db,
        user=actor,
        action="email.retried",
        entity_type="email",
        entity_id=message.id,
        metadata={"template": message.template},
    )

    db.commit()
    db.refresh(message)

    return message
