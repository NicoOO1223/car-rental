"""
Request, approve, pay.

A booking, from staff or from the website, starts as a request. Staff approve it;
if an advance is due the renter is asked to pay it and the car is held for them
until a deadline; paying it confirms the booking. With no advance due (the online
share is 0, staff waived it, or online payment is not set up) approving confirms
the booking at once.

PENDING            a request nobody has answered. Holds nothing.
AWAITING_PAYMENT   approved, advance requested. Holds the car until
                   `hold_expires_at`; lapses (EXPIRED) if not paid by then.
CONFIRMED          paid, waived, or recorded by hand.

The same AWAITING_PAYMENT, hold and sweeper that the website's instant booking
uses are reused; what differs is the length of the window (hours, not the
minutes of a checkout) and that the payment is started from a link in an email,
not from the booking form.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

import stripe
from sqlalchemy.orm import Session

from app.errors import AppError, NotFoundError
from app.models import Reservation, ReservationPayment, User
from app.services.audit import audit_log
from app.services.availability import has_conflicting_maintenance, has_conflicting_reservation, lock_car, lock_reservation
from app.services.booking_prices import reservation_price_breakdown
from app.services.configuration import get_configuration
from app.services.email_outbox import (
    queue_booking_confirmed,
    queue_payment_requested,
    storefront_url,
)
from app.services.money import to_cents
from app.services.prepayments import get_prepayment
from app.services.public_booking import on_prepayment_succeeded
from app.services.public_catalog import cancellation_deadline, split_payment
from app.services.references import assign_reference
from app.services.reservations import recheck_before_confirming
from app.services.stripe_errors import stripe_app_error

# The renter needs time to act on the email: nothing shorter is ever asked of them.
MIN_PAYMENT_WINDOW = timedelta(minutes=30)
# A payment must have closed this long before pickup, so the counter is never surprised.
CLOSE_BEFORE_PICKUP = timedelta(hours=1)

ManualMethod = Literal["CASH", "TRANSFER"]


def online_advance_available(configuration) -> bool:
    """Whether an advance can be paid online here: Stripe is set up, there is a
    booking site to pay on, and online booking is switched on."""

    return bool(stripe.api_key) and bool(storefront_url()) and bool(configuration.storefront_enabled)


def _total(db: Session, reservation: Reservation) -> Decimal:
    if reservation.agreed_total_amount is not None:
        return Decimal(reservation.agreed_total_amount)

    return reservation_price_breakdown(db, reservation).total_amount


def payment_deadline(now: datetime, pickup_at: datetime, window_hours: int) -> datetime:
    """When an advance asked for now has to be paid by: the window, but no later than
    shortly before pickup."""

    return min(now + timedelta(hours=window_hours), pickup_at - CLOSE_BEFORE_PICKUP)


def _open(db: Session, reservation_id) -> Reservation:
    reservation = lock_reservation(db, reservation_id)

    if reservation is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    return reservation


def _not_in_state(reservation: Reservation, to_status: str) -> AppError:
    return AppError(
        "reservation.cannot_change_status",
        f"Cannot change reservation status from {reservation.status} to {to_status}.",
        from_status=reservation.status,
        to_status=to_status,
    )


# --- approving ----------------------------------------------------------------------------------


def approve_reservation(
    db: Session,
    reservation_id,
    actor: User,
    advance: Literal["request", "none"] = "request",
    now: datetime | None = None,
) -> Reservation:
    """
    Approves a PENDING request. `advance` "request" asks the renter for the advance
    (when one is due) and holds the car until they pay or staff record it; "none"
    confirms it without one.
    """

    now = now or datetime.now(timezone.utc)
    reservation = _open(db, reservation_id)

    if reservation.status != "PENDING":
        raise _not_in_state(reservation, "CONFIRMED")

    configuration = get_configuration(db)

    # The car is checked and locked as for any confirmation; an advance holds it too.
    recheck_before_confirming(db, reservation)

    total = _total(db, reservation)
    percent = configuration.online_share_percent
    amount = split_payment(total, percent)[0] if (advance == "request" and percent > 0 and total > 0) else Decimal("0.00")

    if amount > 0:
        # Where online payment is not set up the renter is still asked, and the car
        # still held; staff record the advance by hand when it arrives (cash or transfer).
        deadline = payment_deadline(now, reservation.pickup_at, configuration.payment_window_hours)

        if deadline < now + MIN_PAYMENT_WINDOW:
            raise AppError(
                "reservation.advance_too_late",
                "Pickup is too soon to ask for an advance payment. Confirm without an advance.",
            )

        assign_reference(db, reservation)
        reservation.status = "AWAITING_PAYMENT"
        reservation.hold_expires_at = deadline
        reservation.advance_amount = amount
        reservation.prepayment_percent = percent
        reservation.cancellation_deadline_at = cancellation_deadline(configuration, reservation.pickup_at)
        reservation.updated_by = actor.id

        audit_log(
            db,
            user=actor,
            action="reservation.approved",
            entity_type="reservation",
            entity_id=reservation.id,
            metadata={"advance": str(amount), "deadline": deadline.isoformat()},
        )

        db.flush()
        db.refresh(reservation)
        queue_payment_requested(db, reservation, attempt=str(int(now.timestamp())))
    else:
        reservation.status = "CONFIRMED"
        reservation.updated_by = actor.id

        audit_log(
            db,
            user=actor,
            action="reservation.status_changed",
            entity_type="reservation",
            entity_id=reservation.id,
            metadata={"from": "PENDING", "to": "CONFIRMED", "advance": "none"},
        )

        queue_booking_confirmed(db, reservation)

    db.commit()
    db.refresh(reservation)

    return reservation


# --- staff actions on a payment request ---------------------------------------------------------


def record_advance_received(
    db: Session, reservation_id, method: ManualMethod, actor: User, now: datetime | None = None
) -> Reservation:
    """The advance was handed over by hand (cash, or a bank transfer). Confirms the
    booking the same way an online payment does, with its advance invoice."""

    now = now or datetime.now(timezone.utc)
    reservation = _open(db, reservation_id)

    if reservation.status != "AWAITING_PAYMENT" or reservation.advance_amount is None:
        raise _not_in_state(reservation, "CONFIRMED")

    configuration = get_configuration(db)
    payment = get_prepayment(db, reservation.id)

    # An online payment that was started is closed so the renter cannot also pay it.
    if payment is not None and payment.stripe_payment_intent_id and stripe.api_key:
        try:
            intent = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)

            if intent.status == "succeeded":
                raise AppError(
                    "reservation.advance_already_paid",
                    "The advance has already been paid.",
                    status_code=409,
                )

            if intent.status != "canceled":
                stripe.PaymentIntent.cancel(intent.id)
        except stripe.StripeError as exc:
            raise stripe_app_error(exc)

    if payment is None:
        payment = ReservationPayment(reservation_id=reservation.id, kind="PREPAYMENT")
        db.add(payment)

    payment.payment_method = method
    payment.payment_amount = reservation.advance_amount
    payment.payment_currency = reservation.agreed_currency or configuration.default_currency
    payment.payment_status = "SUCCEEDED"
    payment.paid_at = now

    audit_log(
        db,
        user=actor,
        action="reservation.advance_recorded",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"method": method, "amount": str(reservation.advance_amount)},
    )

    db.flush()
    on_prepayment_succeeded(db, payment, now)

    db.commit()
    db.refresh(reservation)

    return reservation


def resend_payment_request(db: Session, reservation_id, actor: User, now: datetime | None = None) -> Reservation:
    """Sends the payment request email again, with a fresh link."""

    now = now or datetime.now(timezone.utc)
    reservation = _open(db, reservation_id)

    if reservation.status != "AWAITING_PAYMENT":
        raise _not_in_state(reservation, "AWAITING_PAYMENT")

    queue_payment_requested(db, reservation, attempt=f"resend-{int(now.timestamp())}")

    audit_log(
        db,
        user=actor,
        action="reservation.payment_request_resent",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={},
    )

    db.commit()
    db.refresh(reservation)

    return reservation


def extend_payment_window(
    db: Session, reservation_id, hours: int, actor: User, now: datetime | None = None
) -> Reservation:
    """Gives the renter more time. Also brings back a booking whose window ran out,
    if its car is still free."""

    now = now or datetime.now(timezone.utc)
    reservation = _open(db, reservation_id)

    reopening = reservation.status == "EXPIRED" and reservation.advance_amount is not None

    if reservation.status != "AWAITING_PAYMENT" and not reopening:
        raise _not_in_state(reservation, "AWAITING_PAYMENT")

    deadline = min(max(reservation.hold_expires_at or now, now) + timedelta(hours=hours), reservation.pickup_at - CLOSE_BEFORE_PICKUP)

    if deadline < now + MIN_PAYMENT_WINDOW:
        raise AppError(
            "reservation.advance_too_late",
            "Pickup is too soon to ask for an advance payment. Confirm without an advance.",
        )

    if reopening:
        lock_car(db, reservation.car_id)

        if has_conflicting_reservation(
            db, reservation.car_id, reservation.pickup_at, reservation.return_at, exclude_reservation_id=reservation.id
        ) or has_conflicting_maintenance(db, reservation.car_id, reservation.pickup_at, reservation.return_at):
            raise AppError(
                "reservation.cannot_confirm_car_already_reserved",
                "This car is already confirmed or active for part of this period.",
            )

        reservation.status = "AWAITING_PAYMENT"

    reservation.hold_expires_at = deadline
    reservation.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="reservation.payment_window_extended",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"deadline": deadline.isoformat(), "reopened": reopening},
    )

    db.flush()
    db.refresh(reservation)
    queue_payment_requested(db, reservation, attempt=f"extend-{int(now.timestamp())}")

    db.commit()
    db.refresh(reservation)

    return reservation


# --- the renter pays ----------------------------------------------------------------------------


def start_payment(
    db: Session,
    reservation: Reservation,
    *,
    terms_accepted: bool,
    privacy_acknowledged: bool,
    now: datetime | None = None,
) -> tuple[str, Decimal, str]:
    """
    Starts (or resumes) the card payment of the advance for an approved booking.
    Returns (Stripe client secret, amount, currency). The renter has to accept the
    terms and privacy notice if they never did (a booking staff made for them).
    """

    now = now or datetime.now(timezone.utc)

    if not stripe.api_key:
        raise AppError(
            "stripe.not_configured",
            "Stripe is not configured on the server. Set STRIPE_SECRET_KEY "
            "in backend/.env to enable payments.",
            status_code=503,
        )

    reservation = _open(db, reservation.id)

    if (
        reservation.status != "AWAITING_PAYMENT"
        or reservation.hold_expires_at is None
        or reservation.hold_expires_at <= now
        or reservation.advance_amount is None
    ):
        raise AppError(
            "public.payment_not_open",
            "This booking is not waiting for a payment. Contact us if you need help.",
            status_code=409,
        )

    configuration = get_configuration(db)
    customer = reservation.customer

    if customer.terms_accepted_at is None:
        if not (terms_accepted and privacy_acknowledged):
            raise AppError(
                "public.terms_required",
                "Please accept the terms and acknowledge the privacy notice to book.",
            )

        customer.terms_accepted_at = now
        customer.terms_version = configuration.legal_version
        customer.privacy_acknowledged_at = now
        customer.privacy_version = configuration.legal_version

    amount = Decimal(reservation.advance_amount)
    currency = reservation.agreed_currency or configuration.default_currency
    payment = get_prepayment(db, reservation.id)

    if payment is not None and payment.payment_status == "SUCCEEDED":
        raise AppError("public.already_paid", "This advance has already been paid.", status_code=409)

    try:
        # A payment already started for this amount is picked up again.
        if payment is not None and payment.stripe_payment_intent_id and payment.payment_status in ("PENDING", "PROCESSING"):
            intent = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)

            if intent.status in ("requires_payment_method", "requires_confirmation", "requires_action") and intent.amount == to_cents(amount):
                db.commit()

                return intent.client_secret, amount, currency

            if intent.status not in ("canceled", "succeeded"):
                stripe.PaymentIntent.cancel(intent.id)

        intent = stripe.PaymentIntent.create(
            amount=to_cents(amount),
            currency=currency,
            payment_method_types=["card"],
            receipt_email=customer.email,
            description=f"Car rental {reservation.public_reference}",
            metadata={"reservation_id": str(reservation.id), "reference": reservation.public_reference or ""},
            idempotency_key=f"advance-pi:{reservation.id}:{int(now.timestamp())}",
        )
    except stripe.StripeError as exc:
        raise stripe_app_error(exc)

    if payment is None:
        payment = ReservationPayment(reservation_id=reservation.id, kind="PREPAYMENT")
        db.add(payment)

    payment.payment_method = "CARD"
    payment.payment_amount = amount
    payment.payment_currency = currency
    payment.payment_status = "PROCESSING"
    payment.stripe_payment_intent_id = intent.id
    db.commit()

    return intent.client_secret, amount, currency
