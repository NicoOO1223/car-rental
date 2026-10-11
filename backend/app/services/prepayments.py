"""
The share of a rental a renter paid online: reading it, and giving it back or
keeping it when the booking is cancelled.

The policy is the admin's: the share is refunded in full when the booking is
cancelled up to the cancellation deadline stored on it, and kept after that (and
always kept for a no-show). Staff can override it for one cancellation.
"""

from datetime import datetime, timezone
from decimal import Decimal

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Reservation, ReservationPayment, User
from app.services.audit import audit_log
from app.services.invoices import issue_credit_note_for_payment, issue_invoice_for_prepayment
from app.services.stripe_errors import stripe_app_error
from app.services.stripe_sync import apply_payment_intent_status


def get_prepayment(db: Session, reservation_id) -> ReservationPayment | None:
    return db.scalar(select(ReservationPayment).where(ReservationPayment.reservation_id == reservation_id))


def prepaid_amount(db: Session, reservation_id) -> Decimal:
    """What the renter has paid online and still stands (not refunded)."""

    payment = get_prepayment(db, reservation_id)

    if payment is None or payment.payment_status != "SUCCEEDED" or payment.payment_amount is None:
        return Decimal("0.00")

    return Decimal(payment.payment_amount)


def refund_prepayment(db: Session, payment: ReservationPayment, actor: User | None = None) -> None:
    """
    Gives the whole online share back through Stripe and reverses its invoice
    with a credit note (if it had one). Never commits: the caller commits it
    together with whatever made the refund necessary.
    """

    if payment.payment_status != "SUCCEEDED":
        return

    # An advance handed over by hand (cash, transfer) has no card to credit: the
    # refund is recorded, and the money goes back by the same hand.
    if payment.payment_method in ("CASH", "TRANSFER"):
        payment.refund_amount = payment.payment_amount
        payment.refunded_at = datetime.now(timezone.utc)
        payment.payment_status = "REFUNDED"
        issue_credit_note_for_payment(db, payment, actor)

        return

    try:
        refund = stripe.Refund.create(
            payment_intent=payment.stripe_payment_intent_id,
            idempotency_key=f"prepayment-refund:{payment.id}",
        )
    except stripe.StripeError as exc:
        raise stripe_app_error(exc)

    payment.stripe_refund_id = refund.id
    payment.refund_amount = payment.payment_amount
    payment.refunded_at = datetime.now(timezone.utc)
    payment.payment_status = "REFUNDED"

    issue_credit_note_for_payment(db, payment, actor)


def refund_is_free(reservation: Reservation, now: datetime | None = None) -> bool:
    """Whether cancelling now gives the online share back."""

    now = now or datetime.now(timezone.utc)

    return reservation.cancellation_deadline_at is None or now <= reservation.cancellation_deadline_at


def settle_prepayment_for_cancellation(
    db: Session, reservation: Reservation, actor: User | None, refund: bool | None
) -> str | None:
    """
    Decides what happens to the online share of a booking being cancelled.
    `refund` None follows the policy (refund up to the deadline); True or False
    is a decision by staff. Returns "refunded", "kept", "released" (a payment
    that never completed was closed) or None (no online payment at all).
    Never commits.
    """

    payment = get_prepayment(db, reservation.id)

    if payment is None:
        return None

    if payment.payment_status in ("PENDING", "PROCESSING", "FAILED"):
        # Not paid, as far as we know. Ask Stripe once more, so a payment that
        # completed a moment ago is refunded instead of left as a charge.
        if stripe.api_key and payment.stripe_payment_intent_id:
            try:
                intent = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)

                if intent.status == "succeeded":
                    apply_payment_intent_status(payment, intent.status)
                    issue_invoice_for_prepayment(db, payment, actor)
                elif intent.status != "canceled":
                    stripe.PaymentIntent.cancel(intent.id)
                    payment.payment_status = "CANCELLED"
            except stripe.StripeError as exc:
                raise stripe_app_error(exc)
        else:
            payment.payment_status = "CANCELLED"

        if payment.payment_status != "SUCCEEDED":
            return "released"

    if payment.payment_status != "SUCCEEDED":
        return None

    if refund is None:
        refund = refund_is_free(reservation)

    if refund:
        refund_prepayment(db, payment, actor)

        audit_log(
            db,
            user=actor,
            action="reservation_payment.refunded",
            entity_type="reservation",
            entity_id=reservation.id,
            metadata={"amount": str(payment.refund_amount), "reason": reservation.cancellation_reason},
        )

        return "refunded"

    audit_log(
        db,
        user=actor,
        action="reservation_payment.kept",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"amount": str(payment.payment_amount), "reason": reservation.cancellation_reason},
    )

    return "kept"
