"""
Everything an administrator can do about email from Configuration > Email: see
whether it works, pause it, choose where replies go, switch emails on and off,
reword each email and the reusable parts in each language, preview and test-send,
look at what was sent and retry what failed.

Whether email is set up at all (the sending domain and the connection to Azure) is
decided when the stack is provisioned (deploy/provision.ps1), because creating and
verifying the domain needs Azure rights the application deliberately does not have.
"""

import os
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError, NotFoundError
from app.i18n.documents import document_language
from app.i18n.email_templates import TEST
from app.languages import SUPPORTED_LANGUAGES
from app.models import (
    EmailMessage,
    EmailPart,
    EmailSettings,
    EmailTemplate,
    EmailTypeSetting,
    User,
)
from app.services import email_outbox
from app.services.audit import audit_log
from app.services.configuration import get_configuration
from app.services.email_render import (
    WordingError,
    Wording,
    check_body,
    check_part,
    check_subject,
    default_part,
    default_template,
    render,
    to_html,
)
from app.services.email_types import (
    PARTS,
    SAMPLE_BUSINESS,
    SAMPLE_FOOTER,
    SAMPLE_VALUES,
    SAMPLE_VARIANTS,
    STORAGE_PARTS,
    TYPES,
    EmailType,
    options_with_defaults,
    part_users,
)

_ADDRESS = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _wording_error(error: WordingError) -> AppError:
    return AppError(f"email.{error.code}", str(error), **error.params)


def _language(language: str) -> str:
    if language not in SUPPORTED_LANGUAGES:
        raise AppError("email.unknown_language", "That language is not supported.")

    return language


def _type(key: str) -> EmailType:
    email_type = TYPES.get(key)

    if email_type is None:
        raise NotFoundError("email.unknown_type", "There is no such email.")

    return email_type


def _settings(db: Session) -> EmailSettings:
    settings = db.get(EmailSettings, 1)

    if settings is None:
        settings = EmailSettings(id=1, enabled=True)
        db.add(settings)
        db.flush()

    return settings


def _audit(db: Session, actor: User, action: str, **metadata) -> None:
    audit_log(db, user=actor, action=action, entity_type="email", entity_id=None, metadata=metadata)


# --- status, pause, reply-to -------------------------------------------------------------------


def status(db: Session) -> dict:
    settings = db.get(EmailSettings, 1)
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    configuration = get_configuration(db)

    def count(*conditions):
        return db.scalar(select(func.count()).select_from(EmailMessage).where(*conditions)) or 0

    sender = email_outbox._thread

    return {
        "set_up": email_outbox.email_enabled(),
        "paused": settings is not None and not settings.enabled,
        "from_address": os.getenv("EMAIL_FROM_ADDRESS") or None,
        "reply_to": settings.reply_to if settings is not None else None,
        "reply_to_default": configuration.email or None,
        "storefront_url": email_outbox.storefront_url() or None,
        "worker_running": bool(sender is not None and sender.is_alive()),
        "pending": count(EmailMessage.status == "PENDING"),
        "failed": count(EmailMessage.status == "FAILED"),
        "sent_last_7_days": count(EmailMessage.status == "SENT", EmailMessage.sent_at >= week_ago),
        "oldest_pending_at": db.scalar(select(func.min(EmailMessage.created_at)).where(EmailMessage.status == "PENDING")),
        "last_sent_at": db.scalar(select(func.max(EmailMessage.sent_at)).where(EmailMessage.status == "SENT")),
        "default_language": configuration.default_language,
    }


def set_paused(db: Session, actor: User, paused: bool) -> None:
    settings = _settings(db)

    if settings.enabled == (not paused):
        return

    settings.enabled = not paused
    settings.updated_at = datetime.now(timezone.utc)
    _audit(db, actor, "email.paused" if paused else "email.resumed")
    db.commit()


def set_reply_to(db: Session, actor: User, address: str | None) -> None:
    """Where renters' replies go. Empty = the business's own email (Configuration > Business)."""

    address = (address or "").strip() or None

    if address is not None and not _ADDRESS.match(address):
        raise AppError("email.address_invalid", "Enter a valid email address.")

    settings = _settings(db)

    if settings.reply_to == address:
        return

    settings.reply_to = address
    settings.updated_at = datetime.now(timezone.utc)
    _audit(db, actor, "email.reply_to_changed")
    db.commit()


# --- the emails --------------------------------------------------------------------------------


def _template_view(db_templates: dict, type_key: str, language: str) -> dict:
    default_subject, default_body = default_template(type_key, language)
    stored = db_templates.get((type_key, language))

    return {
        "subject": stored[0] if stored else default_subject,
        "body": stored[1] if stored else default_body,
        "default_subject": default_subject,
        "default_body": default_body,
        "customised": stored is not None,
    }


def _stored_templates(db: Session) -> dict:
    return {(row.type, row.language): (row.subject, row.body) for row in db.scalars(select(EmailTemplate))}


def _type_row(db: Session, email_type: EmailType) -> dict:
    setting = db.get(EmailTypeSetting, email_type.key)

    return {
        "key": email_type.key,
        "audience": email_type.audience,
        "can_disable": email_type.can_disable,
        "enabled": True if setting is None else setting.enabled,
        "options": options_with_defaults(email_type, setting.options if setting is not None else None),
        "option_kinds": {option.name: option.kind for option in email_type.options},
    }


def list_types(db: Session) -> list[dict]:
    stored = _stored_templates(db)
    rows = []

    for email_type in TYPES.values():
        row = _type_row(db, email_type)
        row["customised_languages"] = [
            language for language in SUPPORTED_LANGUAGES if (email_type.key, language) in stored
        ]
        row["last_sent_at"] = db.scalar(
            select(func.max(EmailMessage.sent_at)).where(
                EmailMessage.template == email_type.key, EmailMessage.status == "SENT"
            )
        )
        rows.append(row)

    return rows


def get_type(db: Session, key: str) -> dict:
    email_type = _type(key)
    stored = _stored_templates(db)
    row = _type_row(db, email_type)

    row["values"] = list(email_type.values)
    row["global_values"] = ["business", "contact"]
    row["parts"] = list(email_type.parts)
    row["languages"] = {
        language: _template_view(stored, key, language) for language in SUPPORTED_LANGUAGES
    }

    return row


def set_type(db: Session, actor: User, key: str, enabled: bool | None, options: dict | None) -> None:
    email_type = _type(key)
    setting = db.get(EmailTypeSetting, key)

    if setting is None:
        setting = EmailTypeSetting(type=key, enabled=True, options={})
        db.add(setting)

    if enabled is not None:
        if not enabled and not email_type.can_disable:
            raise AppError("email.cannot_disable", "This email cannot be switched off.")

        setting.enabled = enabled

    if options:
        known = {option.name: option for option in email_type.options}
        merged = dict(setting.options or {})

        for name, value in options.items():
            option = known.get(name)

            if option is None:
                raise AppError("email.unknown_option", "There is no such option.")

            if option.kind == "bool" and not isinstance(value, bool):
                raise AppError("email.option_invalid", "That value is not valid for this option.")

            if option.kind == "hours" and (isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 720):
                raise AppError("email.option_invalid", "That value is not valid for this option.")

            merged[name] = value

        setting.options = merged

    setting.updated_at = datetime.now(timezone.utc)
    setting.updated_by = actor.id
    _audit(db, actor, "email.type_changed", type=key, enabled=setting.enabled)
    db.commit()


def save_template(db: Session, actor: User, key: str, language: str, subject: str, body: str) -> None:
    email_type = _type(key)
    _language(language)

    try:
        subject = check_subject(email_type, subject)
        body = check_body(email_type, body)
    except WordingError as error:
        raise _wording_error(error)

    row = db.get(EmailTemplate, (key, language))

    if row is None:
        row = EmailTemplate(type=key, language=language, subject=subject, body=body)
        db.add(row)
    elif (row.subject, row.body) == (subject, body):
        return

    row.subject, row.body = subject, body
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = actor.id
    _audit(db, actor, "email.template_changed", type=key, language=language)
    db.commit()


def reset_template(db: Session, actor: User, key: str, language: str) -> None:
    _type(key)
    _language(language)

    row = db.get(EmailTemplate, (key, language))

    if row is None:
        return

    db.delete(row)
    _audit(db, actor, "email.template_reset", type=key, language=language)
    db.commit()


# --- the reusable parts ------------------------------------------------------------------------


def list_parts(db: Session) -> list[dict]:
    stored = {(row.key, row.language): row.text for row in db.scalars(select(EmailPart))}
    rows = []

    for part in PARTS.values():
        for storage_key in part.storage_keys:
            rows.append(
                {
                    "key": storage_key,
                    "part": part.key,
                    "variant": storage_key.split(".", 1)[1] if part.variants else None,
                    "values": list(part.values),
                    "used_by": part_users(part.key),
                    "languages": {
                        language: {
                            "text": stored.get((storage_key, language), default_part(storage_key, language)),
                            "default": default_part(storage_key, language),
                            "customised": (storage_key, language) in stored,
                        }
                        for language in SUPPORTED_LANGUAGES
                    },
                }
            )

    return rows


def save_part(db: Session, actor: User, key: str, language: str, text: str) -> None:
    _language(language)

    try:
        text = check_part(key, text)
    except WordingError as error:
        raise _wording_error(error)

    row = db.get(EmailPart, (key, language))

    if row is None:
        row = EmailPart(key=key, language=language, text=text)
        db.add(row)
    elif row.text == text:
        return

    row.text = text
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = actor.id
    _audit(db, actor, "email.part_changed", part=key, language=language, left_out=text == "")
    db.commit()


def reset_part(db: Session, actor: User, key: str, language: str) -> None:
    _language(language)

    if key not in STORAGE_PARTS:
        raise AppError("email.unknown_part", "There is no such part.")

    row = db.get(EmailPart, (key, language))

    if row is None:
        return

    db.delete(row)
    _audit(db, actor, "email.part_reset", part=key, language=language)
    db.commit()


# --- preview and test ---------------------------------------------------------------------------


def _drafted_wording(
    db: Session, key: str, language: str, subject: str | None, body: str | None, parts: dict[str, str]
) -> Wording:
    """The wording in force, with a draft (not saved) laid over it. The draft is
    checked first, exactly as saving would."""

    email_type = _type(key)
    wording = email_outbox.load_wording(db)

    try:
        if subject is not None or body is not None:
            current = wording.template(key, language)
            wording.templates[(key, language)] = (
                check_subject(email_type, subject) if subject is not None else current[0],
                check_body(email_type, body) if body is not None else current[1],
            )

        for part_key, text in parts.items():
            wording.parts[(part_key, language)] = check_part(part_key, text)
    except WordingError as error:
        raise _wording_error(error)

    return wording


def _render_sample(db: Session, key: str, language: str, wording: Wording):
    email_type = _type(key)
    language = _language(language)

    return render(
        wording,
        email_type,
        language,
        {**SAMPLE_BUSINESS, **SAMPLE_VALUES[key]},
        part_variants=SAMPLE_VARIANTS.get(key),
        footer=SAMPLE_FOOTER,
    )


def preview(db: Session, key: str, language: str, subject: str | None, body: str | None, parts: dict[str, str]) -> dict:
    """The email as it would read with a draft (not saved yet) laid over what is
    saved, filled in with sample values."""

    _language(language)
    rendered = _render_sample(db, key, language, _drafted_wording(db, key, language, subject, body, parts))

    return {"subject": rendered.subject, "body": rendered.text}


def send_test(db: Session, actor: User, to_address: str | None, key: str | None, language: str | None) -> dict:
    """Sends an email right now, straight through Azure, and reports what happened,
    so a problem with the setup shows here instead of silently on a renter's
    booking. With `key`, it is that email as it reads now, with sample values;
    without, a short message that only shows sending works. Nothing is queued."""

    address = (to_address or actor.email or "").strip()

    if not _ADDRESS.match(address):
        raise AppError("email.test_address_invalid", "Enter a valid email address.")

    if not email_outbox.email_enabled():
        raise AppError("email.not_set_up", "Email is not set up on this stack yet.")

    configuration = get_configuration(db)
    language = _language(language or document_language(configuration.default_language))

    if key is not None:
        rendered = _render_sample(db, key, language, email_outbox.load_wording(db))
        subject, body, html = "[TEST] " + rendered.subject, rendered.text, rendered.html
    else:
        test_subject, test_body = TEST[language]
        values = {"business": configuration.business_name}
        subject, body = test_subject.format(**values), test_body.format(**values)
        html = f"<!doctype html><html><body>{to_html(body)}</body></html>"

    message = SimpleNamespace(
        to_address=address,
        to_name=None,
        reply_to=email_outbox.reply_to_address(db),
        subject=subject,
        body_text=body,
        body_html=html,
    )

    sender = email_outbox.configured_sender()
    outcome = {"sent": True, "error": None, "to": address}

    try:
        sender.send(message, None)
    except Exception as error:  # noqa: BLE001 - whatever Azure says is what the administrator needs to see
        outcome = {"sent": False, "error": str(error)[:500], "to": address}

    _audit(db, actor, "email.test_sent" if outcome["sent"] else "email.test_failed", type=key)
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
