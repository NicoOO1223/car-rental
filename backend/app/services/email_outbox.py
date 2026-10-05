"""
Emails: queued with the event that causes them, sent afterwards.

Two halves.

Queuing (queue_email and the queue_* events): called from inside the transaction
that confirms a booking, cancels one or takes a payment. It writes a row to the
outbox (EmailMessage) and nothing else, so it exists if and only if the event did.
It can never fail the event it belongs to: anything that goes wrong writing the row
is logged and dropped. Nothing is queued when email is not set up on this stack,
when sending is paused, or when that kind of email is switched off.

What an email says comes from app/services/email_render.py and the wording in force
(the built-in text, over which the business's own from Configuration > Email).

Sending (flush_outbox): a worker takes due messages one at a time, sends them
through Azure Communication Services Email, and marks them sent. A failed send is
tried again later, with growing gaps, and given up on after MAX_ATTEMPTS. Several
workers (several replicas) can run at once: each claims a message with FOR UPDATE
SKIP LOCKED, so one message is sent by one of them.

Environment, per stack (set by deploy/provision.ps1):
  EMAIL_CONNECTION_STRING   the Communication Services connection string
  EMAIL_FROM_ADDRESS        the verified sender, e.g. bookings@yourcompany.com
  STOREFRONT_URL            the public booking site, for links in emails (optional)
Without the first two, email is off and the application behaves as it did before.
"""

import base64
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.i18n.documents import document_language, format_amount
from app.languages import DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES
from app.models import (
    Customer,
    EmailMessage,
    EmailPart,
    EmailSettings,
    EmailTemplate,
    EmailTypeSetting,
    Invoice,
    Reservation,
)
from app.models.email_message import MAX_ATTEMPTS
from app.services.configuration import get_configuration
from app.services.email_render import Wording, footer_lines, render
from app.services.email_types import TYPES, options_with_defaults
from app.services.pdf_common import format_local

logger = logging.getLogger("email_outbox")

# How long to wait before trying again, by how many tries have failed so far.
RETRY_DELAYS = (
    timedelta(minutes=1),
    timedelta(minutes=5),
    timedelta(minutes=30),
    timedelta(hours=2),
    timedelta(hours=6),
)


def email_enabled() -> bool:
    """Whether email is set up on this stack at all (decided when it is provisioned)."""

    return bool(os.getenv("EMAIL_CONNECTION_STRING") and os.getenv("EMAIL_FROM_ADDRESS"))


def email_paused(db: Session) -> bool:
    """Whether an administrator has paused sending from the settings screen."""

    settings = db.get(EmailSettings, 1)

    return settings is not None and not settings.enabled


def email_active(db: Session) -> bool:
    """Set up, and not paused: the condition for queuing a new email."""

    return email_enabled() and not email_paused(db)


def storefront_url() -> str:
    """The public booking site's address, for links in emails; empty if not set."""

    return os.getenv("STOREFRONT_URL", "").strip().rstrip("/")


# --- the wording and settings in force --------------------------------------------------------


def load_wording(db: Session) -> Wording:
    """The business's own messages and parts (the built-in ones for the rest)."""

    templates = {
        (row.type, row.language): (row.subject, row.body) for row in db.scalars(select(EmailTemplate))
    }
    parts = {(row.key, row.language): row.text for row in db.scalars(select(EmailPart))}

    return Wording(templates, parts)


def type_enabled(db: Session, type_key: str) -> bool:
    """Whether this kind of email is switched on (it is unless an administrator turned it off)."""

    row = db.get(EmailTypeSetting, type_key)

    return row is None or row.enabled


def type_options(db: Session, type_key: str) -> dict:
    row = db.get(EmailTypeSetting, type_key)

    return options_with_defaults(TYPES[type_key], row.options if row is not None else None)


def reply_to_address(db: Session) -> str | None:
    """Where a renter reply goes: what an administrator set, else the business email."""

    settings = db.get(EmailSettings, 1)

    return (settings.reply_to if settings is not None else None) or get_configuration(db).email or None


def renter_language(db: Session, reservation: Reservation) -> str:
    """The language a renter email is written in: the booking own, else the business default."""

    for candidate in (reservation.language, get_configuration(db).default_language, DEFAULT_LANGUAGE):
        if candidate in SUPPORTED_LANGUAGES:
            return candidate

    return DEFAULT_LANGUAGE


def contact_line(configuration) -> str:
    return " / ".join(part for part in (configuration.email, configuration.phone) if part)


def manage_url(reservation: Reservation, language: str) -> str:
    """The link a renter follows to view or cancel their booking: the lookup page with
    the reference filled in. Only bookings made on the website have a reference, and
    only a stack with a storefront has somewhere to link to."""

    base = storefront_url()

    if not base or not reservation.public_reference:
        return ""

    return f"{base}/{language}/manage?reference={reservation.public_reference}"


def build_footer(db: Session, language: str) -> list[str]:
    """The business identity at the end of every renter email (from Configuration > Business)."""

    configuration = get_configuration(db)
    base = storefront_url()

    return footer_lines(
        language,
        legal_name=configuration.legal_name or configuration.business_name,
        address=configuration.address or "",
        vat_id=configuration.vat_id or "",
        privacy_url=f"{base}/{language}/privacy" if base else "",
    )


# --- queuing ---------------------------------------------------------------------------------


def _address_of(customer: Customer) -> str | None:
    """Where to send to, or None for a customer who has no usable address or whose
    data was erased."""

    address = (customer.email or "").strip()

    if customer.anonymized_at is not None or "@" not in address or " " in address:
        return None

    return address


def queue_email(
    db: Session,
    type_key: str,
    *,
    to_address: str,
    to_name: str | None,
    language: str,
    values: dict[str, str],
    dedupe_key: str,
    part_variants: dict[str, str] | None = None,
    reservation_id=None,
    attachment: tuple[str, object] | None = None,
) -> EmailMessage | None:
    """
    Writes one email to the outbox, rendered now in `language` from `values`. Does
    nothing (returns None) if email is off, paused or that type is switched off, or
    if this event already queued its email. Never raises: it joins the caller's
    transaction through a savepoint and logs what goes wrong.

    `attachment` is (kind, id): "invoice" / "credit_note" (an invoice's id) or
    "agreement" (a handover's id).
    """

    if not email_active(db) or not type_enabled(db, type_key):
        return None

    try:
        email_type = TYPES[type_key]
        language = document_language(language)
        configuration = get_configuration(db)
        rendered = render(
            load_wording(db),
            email_type,
            language,
            {"business": configuration.business_name, "contact": contact_line(configuration), **values},
            part_variants=part_variants,
            footer=build_footer(db, language),
        )

        # A savepoint: whatever goes wrong here undoes only the email, never the
        # booking or payment this runs inside.
        with db.begin_nested():
            if db.scalar(select(EmailMessage.id).where(EmailMessage.dedupe_key == dedupe_key)) is not None:
                return None

            message = EmailMessage(
                dedupe_key=dedupe_key,
                template=type_key,
                language=language,
                to_address=to_address,
                to_name=(to_name or "")[:200] or None,
                reply_to=reply_to_address(db),
                subject=rendered.subject[:300],
                body_text=rendered.text,
                body_html=rendered.html,
                reservation_id=reservation_id,
                attachment_kind=attachment[0] if attachment else None,
                attachment_id=attachment[1] if attachment else None,
            )
            db.add(message)
            db.flush()

            return message
    except IntegrityError:
        # The same event queued twice at once; the other one stands.
        return None
    except Exception:  # noqa: BLE001 - an email must never break what caused it
        logger.exception("Could not queue the %s email %s", type_key, dedupe_key)

        return None


def _reference(reservation: Reservation) -> str:
    """What the renter calls the booking: the storefront reference, else the start of its id."""

    return reservation.public_reference or str(reservation.id).split("-")[0].upper()


def _place(location) -> str:
    """A pickup or return place as the renter reads it: its name, and where it is."""

    return ", ".join(part for part in (location.name, (location.address or "").strip()) if part)


def queue_booking_confirmed(db: Session, reservation: Reservation) -> EmailMessage | None:
    if not email_active(db) or not type_enabled(db, "booking_confirmed"):
        return None

    try:
        from app.services.booking_prices import reservation_price_breakdown
        from app.services.prepayments import prepaid_amount

        configuration = get_configuration(db)
        language = renter_language(db, reservation)
        currency = reservation.agreed_currency or configuration.default_currency
        car = reservation.car
        customer = reservation.customer
        address = _address_of(customer)

        if address is None:
            return None

        total = reservation_price_breakdown(db, reservation, car, configuration).total_amount
        paid_online = prepaid_amount(db, reservation.id)
        deadline = reservation.cancellation_deadline_at
        pickup = reservation.pickup_location

        return queue_email(
            db,
            "booking_confirmed",
            to_address=address,
            to_name=f"{customer.first_name} {customer.last_name}".strip(),
            language=language,
            dedupe_key=f"booking_confirmed:{reservation.id}",
            reservation_id=reservation.id,
            values={
                "name": customer.first_name,
                "reference": _reference(reservation),
                "vehicle": f"{car.make} {car.model}",
                "pickup_place": _place(pickup),
                "pickup_time": format_local(reservation.pickup_at, pickup.timezone, language),
                "return_place": _place(reservation.return_location),
                "return_time": format_local(reservation.return_at, reservation.return_location.timezone, language),
                "total": format_amount(total, currency, language),
                "paid_online": format_amount(paid_online, currency, language) if paid_online > 0 else "",
                "cancellation_deadline": format_local(deadline, pickup.timezone, language) if deadline else "",
                "manage_url": manage_url(reservation, language),
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("Could not write the confirmation email for %s", reservation.id)

        return None


def queue_booking_cancelled(
    db: Session,
    reservation: Reservation,
    *,
    online_payment: str | None,
    online_amount: Decimal | None,
) -> EmailMessage | None:
    """`online_payment` is what happened to the share paid online: "refunded",
    "kept", or anything else (nothing to say about money)."""

    if not email_active(db) or not type_enabled(db, "booking_cancelled"):
        return None

    try:
        configuration = get_configuration(db)
        language = renter_language(db, reservation)
        currency = reservation.agreed_currency or configuration.default_currency
        car = reservation.car
        customer = reservation.customer
        address = _address_of(customer)

        if address is None:
            return None

        has_note = bool(online_amount) and online_payment in ("refunded", "kept")

        return queue_email(
            db,
            "booking_cancelled",
            to_address=address,
            to_name=f"{customer.first_name} {customer.last_name}".strip(),
            language=language,
            dedupe_key=f"booking_cancelled:{reservation.id}",
            reservation_id=reservation.id,
            part_variants={"payment_note": online_payment} if has_note else None,
            values={
                "name": customer.first_name,
                "reference": _reference(reservation),
                "vehicle": f"{car.make} {car.model}",
                "pickup_time": format_local(reservation.pickup_at, reservation.pickup_location.timezone, language),
                "amount": format_amount(online_amount, currency, language) if has_note else "",
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("Could not write the cancellation email for %s", reservation.id)

        return None


def queue_receipt(db: Session, invoice: Invoice) -> EmailMessage | None:
    """A receipt for a payment that was taken, with the invoice attached unless an
    administrator turned that off. Credit notes (refunds) are told in the
    cancellation email instead."""

    if not email_active(db) or not type_enabled(db, "receipt"):
        return None

    try:
        reservation = db.get(Reservation, invoice.reservation_id)
        language = renter_language(db, reservation)
        customer = reservation.customer
        address = _address_of(customer)

        if address is None:
            return None

        attach = bool(type_options(db, "receipt")["attach_invoice"])

        return queue_email(
            db,
            "receipt",
            to_address=address,
            to_name=f"{customer.first_name} {customer.last_name}".strip(),
            language=language,
            dedupe_key=f"receipt:{invoice.id}",
            reservation_id=reservation.id,
            attachment=("invoice", invoice.id) if attach else None,
            values={
                "name": customer.first_name,
                "number": invoice.number,
                "amount": format_amount(invoice.total_amount, invoice.currency, language),
                # Empty when nothing is attached, so the line saying it is attached disappears.
                "attached_invoice": invoice.number if attach else "",
                "manage_url": manage_url(reservation, language),
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("Could not write the receipt email for invoice %s", invoice.id)

        return None


# --- sending ---------------------------------------------------------------------------------


class Sender(Protocol):
    def send(self, message: EmailMessage, attachment: tuple[str, bytes, str] | None) -> None:
        """Sends one email or raises. `attachment` is (file name, bytes, content type)."""


class AzureEmailSender:
    """Azure Communication Services Email."""

    def __init__(self, connection_string: str, from_address: str):
        from azure.communication.email import EmailClient

        self._client = EmailClient.from_connection_string(connection_string)
        self._from = from_address

    def build(self, message: EmailMessage, attachment: tuple[str, bytes, str] | None) -> dict:
        recipient = {"address": message.to_address}

        if message.to_name:
            recipient["displayName"] = message.to_name

        payload: dict = {
            "senderAddress": self._from,
            "recipients": {"to": [recipient]},
            "content": {
                "subject": message.subject,
                "plainText": message.body_text,
                "html": message.body_html,
            },
        }

        if message.reply_to:
            payload["replyTo"] = [{"address": message.reply_to}]

        if attachment is not None:
            name, data, content_type = attachment
            payload["attachments"] = [
                {"name": name, "contentType": content_type, "contentInBase64": base64.b64encode(data).decode("ascii")}
            ]

        return payload

    def send(self, message: EmailMessage, attachment: tuple[str, bytes, str] | None) -> None:
        result = self._client.begin_send(self.build(message, attachment)).result(timeout=60)

        if result.get("status") != "Succeeded":
            raise RuntimeError(f"Email service answered {result.get('status')}: {result.get('error')}")


def configured_sender() -> Sender | None:
    if not email_enabled():
        return None

    return AzureEmailSender(os.environ["EMAIL_CONNECTION_STRING"], os.environ["EMAIL_FROM_ADDRESS"])


def _attachment_for(db: Session, message: EmailMessage) -> tuple[str, bytes, str] | None:
    """The PDF to attach, drawn now from what the message points at."""

    if message.attachment_kind is None:
        return None

    if message.attachment_kind in ("invoice", "credit_note"):
        from app.services.invoice_pdf import render_invoice_pdf

        invoice = db.get(Invoice, message.attachment_id)

        if invoice is None:
            return None

        return (f"{invoice.number}.pdf", render_invoice_pdf(db, invoice), "application/pdf")

    if message.attachment_kind == "agreement":
        from app.models import Handover

        handover = db.get(Handover, message.attachment_id)

        if handover is None or handover.agreement_pdf is None:
            return None

        return (f"agreement-{handover.reservation_id}.pdf", bytes(handover.agreement_pdf), "application/pdf")

    return None


def flush_outbox(db: Session, sender: Sender, *, limit: int = 20, now: datetime | None = None) -> dict:
    """
    Sends the messages that are due, one at a time. Returns how many were sent,
    how many failed and will be retried, and how many were given up on.
    """

    result = {"sent": 0, "retry": 0, "given_up": 0}
    now = now or datetime.now(timezone.utc)

    for _ in range(limit):
        message = db.scalar(
            select(EmailMessage)
            .where(EmailMessage.status == "PENDING", EmailMessage.next_attempt_at <= now)
            .order_by(EmailMessage.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )

        if message is None:
            break

        try:
            sender.send(message, _attachment_for(db, message))
        except Exception as error:  # noqa: BLE001 - whatever went wrong, try again later
            message.attempts += 1
            message.last_error = str(error)[:2000]

            if message.attempts >= MAX_ATTEMPTS:
                message.status = "FAILED"
                result["given_up"] += 1
                logger.error("Gave up on email %s (%s) after %s tries: %s", message.id, message.template, message.attempts, error)
            else:
                message.next_attempt_at = now + RETRY_DELAYS[min(message.attempts - 1, len(RETRY_DELAYS) - 1)]
                result["retry"] += 1
                logger.warning("Email %s (%s) failed, will retry: %s", message.id, message.template, error)
        else:
            message.status = "SENT"
            message.sent_at = datetime.now(timezone.utc)
            message.attempts += 1
            message.last_error = None
            result["sent"] += 1

        db.commit()

    return result


# --- the worker ------------------------------------------------------------------------------

_stop = threading.Event()
_thread: threading.Thread | None = None

POLL_SECONDS = 20


def _run() -> None:
    from app.database import SessionLocal

    while not _stop.wait(POLL_SECONDS):
        try:
            sender = configured_sender()

            if sender is None:
                continue

            with SessionLocal() as db:
                # Paused: what is queued waits, and goes out when sending resumes.
                if not email_paused(db):
                    flush_outbox(db, sender)
        except Exception:  # noqa: BLE001 - the loop must outlive any one failure
            logger.exception("The email worker hit an error; it will try again")


def start_worker() -> None:
    """Starts the background sender inside this process, if email is set up. Safe to
    call more than once. Each replica runs one; they share the work safely."""

    global _thread

    if not email_enabled() or (_thread is not None and _thread.is_alive()):
        return

    _stop.clear()
    _thread = threading.Thread(target=_run, name="email-worker", daemon=True)
    _thread.start()
    logger.info("Email sending is on")


def stop_worker() -> None:
    _stop.set()
