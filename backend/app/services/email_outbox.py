"""
Emails to renters: queued with the event that causes them, sent afterwards.

Two halves.

Queuing (queue_*): called from inside the transaction that confirms a booking,
cancels one or takes a payment. It writes a row to the outbox (EmailMessage) and
nothing else, so it exists if and only if the event did. It can never fail the
event it belongs to: anything that goes wrong writing the row is logged and
dropped, and when email is not set up on this stack nothing is queued at all.

Sending (flush_outbox): a worker takes due messages one at a time, sends them
through Azure Communication Services Email, and marks them sent. A failed send
is tried again later, with growing gaps, and given up on after MAX_ATTEMPTS.
Several workers (several replicas) can run at once: each claims a message with
FOR UPDATE SKIP LOCKED, so one message is sent by one of them.

Settings (environment, per stack, set by deploy/provision.ps1):
  EMAIL_CONNECTION_STRING   the Communication Services connection string
  EMAIL_FROM_ADDRESS        the verified sender, e.g. bookings@yourcompany.com
Without both, email is off and the application behaves as it did before.
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
from app.i18n.emails import compose
from app.models import Customer, EmailMessage, EmailSettings, Invoice, Reservation
from app.models.email_message import MAX_ATTEMPTS
from app.services.configuration import get_configuration
from app.services.email_content import (
    build_booking_cancelled,
    build_booking_confirmed,
    build_receipt,
    load_wording,
)
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


# --- queuing ---------------------------------------------------------------------------------


def _address_of(customer: Customer) -> str | None:
    """Where to send to, or None for a customer who has no usable address or whose
    data was erased."""

    address = (customer.email or "").strip()

    if customer.anonymized_at is not None or "@" not in address or " " in address:
        return None

    return address


def _queue(
    db: Session,
    *,
    dedupe_key: str,
    template: str,
    language: str,
    customer: Customer,
    reply_to: str | None,
    subject: str,
    paragraphs: list[str],
    reservation_id=None,
    invoice_id=None,
) -> EmailMessage | None:
    address = _address_of(customer)

    if address is None:
        return None

    text, html = compose(paragraphs)

    try:
        # A savepoint: whatever goes wrong here undoes only the email, never the
        # booking or payment this runs inside.
        with db.begin_nested():
            if db.scalar(select(EmailMessage.id).where(EmailMessage.dedupe_key == dedupe_key)) is not None:
                return None

            message = EmailMessage(
                dedupe_key=dedupe_key,
                template=template,
                language=language,
                to_address=address,
                to_name=f"{customer.first_name} {customer.last_name}".strip()[:200] or None,
                reply_to=reply_to,
                subject=subject[:300],
                body_text=text,
                body_html=html,
                reservation_id=reservation_id,
                invoice_id=invoice_id,
            )
            db.add(message)
            db.flush()

            return message
    except IntegrityError:
        # The same event queued twice at once; the other one stands.
        return None
    except Exception:  # noqa: BLE001 - an email must never break what caused it
        logger.exception("Could not queue the %s email %s", template, dedupe_key)

        return None


def _closing_contact(configuration) -> str:
    return " / ".join(part for part in (configuration.email, configuration.phone) if part)


def _reference(reservation: Reservation) -> str:
    """What the renter calls the booking: the storefront's reference, else the start of its id."""

    return reservation.public_reference or str(reservation.id).split("-")[0].upper()


def queue_booking_confirmed(db: Session, reservation: Reservation) -> EmailMessage | None:
    if not email_active(db):
        return None

    try:
        from app.services.booking_prices import reservation_price_breakdown
        from app.services.prepayments import prepaid_amount

        configuration = get_configuration(db)
        language = document_language(configuration.document_language)
        currency = reservation.agreed_currency or configuration.default_currency
        car = reservation.car
        customer = reservation.customer
        total = reservation_price_breakdown(db, reservation, car, configuration).total_amount
        paid_online = prepaid_amount(db, reservation.id)

        subject, paragraphs = build_booking_confirmed(
            load_wording(db),
            language,
            {
                "name": customer.first_name,
                "business": configuration.business_name,
                "reference": _reference(reservation),
                "vehicle": f"{car.make} {car.model}",
                "pickup_place": reservation.pickup_location.name,
                "pickup_time": format_local(reservation.pickup_at, reservation.pickup_location.timezone, language),
                "return_place": reservation.return_location.name,
                "return_time": format_local(reservation.return_at, reservation.return_location.timezone, language),
                "total": format_amount(total, currency, language),
                "paid_online": format_amount(paid_online, currency, language) if paid_online > 0 else "",
                "contact": _closing_contact(configuration),
            },
        )

        return _queue(
            db,
            dedupe_key=f"booking_confirmed:{reservation.id}",
            template="booking_confirmed",
            language=language,
            customer=customer,
            reply_to=configuration.email,
            subject=subject,
            paragraphs=paragraphs,
            reservation_id=reservation.id,
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

    if not email_active(db):
        return None

    try:
        configuration = get_configuration(db)
        language = document_language(configuration.document_language)
        currency = reservation.agreed_currency or configuration.default_currency
        car = reservation.car
        customer = reservation.customer

        subject, paragraphs = build_booking_cancelled(
            load_wording(db),
            language,
            {
                "name": customer.first_name,
                "business": configuration.business_name,
                "reference": _reference(reservation),
                "vehicle": f"{car.make} {car.model}",
                "when": format_local(reservation.pickup_at, reservation.pickup_location.timezone, language),
                "note": online_payment or "",
                "amount": format_amount(online_amount, currency, language) if online_amount else "",
                "contact": _closing_contact(configuration),
            },
        )

        return _queue(
            db,
            dedupe_key=f"booking_cancelled:{reservation.id}",
            template="booking_cancelled",
            language=language,
            customer=customer,
            reply_to=configuration.email,
            subject=subject,
            paragraphs=paragraphs,
            reservation_id=reservation.id,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Could not write the cancellation email for %s", reservation.id)

        return None


def queue_receipt(db: Session, invoice: Invoice) -> EmailMessage | None:
    """A receipt with the invoice attached, for a payment that was taken. Credit
    notes (refunds) are told in the cancellation email instead."""

    if not email_active(db):
        return None

    try:
        reservation = db.get(Reservation, invoice.reservation_id)
        configuration = get_configuration(db)
        language = document_language(invoice.language)
        customer = reservation.customer

        subject, paragraphs = build_receipt(
            load_wording(db),
            language,
            {
                "name": customer.first_name,
                "business": configuration.business_name,
                "number": invoice.number,
                "amount": format_amount(invoice.total_amount, invoice.currency, language),
                "contact": _closing_contact(configuration),
            },
        )

        return _queue(
            db,
            dedupe_key=f"receipt:{invoice.id}",
            template="receipt",
            language=language,
            customer=customer,
            reply_to=configuration.email,
            subject=subject,
            paragraphs=paragraphs,
            reservation_id=reservation.id,
            invoice_id=invoice.id,
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
    if message.invoice_id is None:
        return None

    from app.services.invoice_pdf import render_invoice_pdf

    invoice = db.get(Invoice, message.invoice_id)

    return (f"{invoice.number}.pdf", render_invoice_pdf(db, invoice), "application/pdf")


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
