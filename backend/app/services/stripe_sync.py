"""
Turning what Stripe says about a PaymentIntent into local payment state.

Two callers share this: the staff-triggered "confirm payment" endpoints
(which ask Stripe directly) and the webhook (which Stripe calls whenever a
payment changes, even if the staff member closed the tab). Keeping the
rules in one place means both behave the same, and both refuse the same
bad transitions.
"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import CheckOut, Handover, ProcessedStripeEvent, ReservationPayment
from app.services.audit import audit_log
from app.services.invoices import issue_invoice_for_handover

# Payment states that a later Stripe status must never overwrite. A
# refunded payment stays refunded, and a payment that succeeded cannot
# un-succeed (a late or replayed "processing" or "canceled" event would
# otherwise flip it back).
_FINAL = ("SUCCEEDED", "REFUNDED")


def apply_payment_intent_status(record: Handover | CheckOut, intent_status: str) -> bool:
    """
    Applies a Stripe PaymentIntent status to a handover or check-out's card
    payment. Returns True if the record changed. Cash payments are left
    alone: no Stripe intent decides them.

    A record the payment already succeeded on never moves backwards, and
    paid_at keeps the first time it was paid.
    """

    if record.payment_method == "CASH":
        return False

    if record.payment_status == "REFUNDED":
        return False

    if intent_status == "succeeded":
        new_status = "SUCCEEDED"
    elif record.payment_status == "SUCCEEDED":
        return False
    elif intent_status == "processing":
        new_status = "PROCESSING"
    elif intent_status == "canceled":
        new_status = "CANCELLED"
    else:
        new_status = "FAILED"

    changed = record.payment_status != new_status
    record.payment_status = new_status

    if new_status == "SUCCEEDED" and record.paid_at is None:
        record.paid_at = datetime.now(timezone.utc)
        changed = True

    return changed


def apply_deposit_intent_status(handover: Handover, intent_status: str) -> bool:
    """
    Applies a Stripe status to a card deposit authorization. Only a pending
    deposit moves: a held, captured or released one is decided by staff at
    check-out, not by a later Stripe event. Returns True if it changed.
    """

    if handover.deposit_method != "CARD":
        return False

    if intent_status == "requires_capture" and handover.deposit_status != "HELD":
        if handover.deposit_status in (None, "PENDING"):
            handover.deposit_status = "HELD"
            handover.deposit_held_at = datetime.now(timezone.utc)
            return True

    if intent_status == "canceled" and handover.deposit_status == "PENDING":
        handover.deposit_status = "CANCELLED"
        return True

    return False


HANDLED_EVENT_TYPES = {
    "payment_intent.succeeded",
    "payment_intent.processing",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
    "payment_intent.amount_capturable_updated",
}


def handle_event(db: Session, event) -> str:
    """
    Applies one verified Stripe event. Returns "duplicate" if it was already
    handled, "ignored" if it is not one we act on or matches nothing we
    know, and "applied" otherwise. Commits, so the dedupe row and the state
    change land together or not at all: if anything raises, nothing is
    recorded and Stripe's retry gets a clean second attempt.
    """

    inserted = db.execute(
        insert(ProcessedStripeEvent)
        .values(
            event_id=event["id"],
            event_type=event["type"],
            processed_at=datetime.now(timezone.utc),
        )
        .on_conflict_do_nothing(index_elements=["event_id"])
        .returning(ProcessedStripeEvent.event_id)
    )

    # RETURNING yields a row only when the insert really happened; rowcount
    # is not reliable for this statement.
    if inserted.first() is None:
        db.rollback()
        return "duplicate"

    result = "ignored"

    if event["type"] in HANDLED_EVENT_TYPES:
        intent = event["data"]["object"]

        if _apply_to_records(db, intent["id"], intent["status"]):
            result = "applied"

    db.commit()

    return result


def _apply_to_records(db: Session, intent_id: str, intent_status: str) -> bool:
    """Finds whatever currently owns this intent id. An intent that was
    replaced (cancelled and recreated for a new amount) is no longer
    referenced by anything, so its late events match nothing and are
    ignored rather than clobbering the replacement."""

    matched = False

    handover = db.scalar(
        select(Handover).where(Handover.stripe_payment_intent_id == intent_id)
    )

    if handover is not None:
        matched = True

        if apply_payment_intent_status(handover, intent_status):
            # The webhook is one of the ways a rental payment is recorded, so
            # it issues the invoice too (idempotently: the staff confirm
            # button may have got there first).
            issue_invoice_for_handover(db, handover, None)

            audit_log(
                db,
                user=None,
                action="handover.payment_confirmed",
                entity_type="handover",
                entity_id=handover.id,
                metadata={
                    "payment_method": "CARD",
                    "stripe_payment_intent_id": intent_id,
                    "payment_status": handover.payment_status,
                    "source": "stripe_webhook",
                },
            )

    prepayment = db.scalar(
        select(ReservationPayment).where(ReservationPayment.stripe_payment_intent_id == intent_id)
    )

    if prepayment is not None:
        matched = True

        # Imported here: the booking service builds on this module.
        from app.services.public_booking import apply_intent_to_prepayment

        outcome = apply_intent_to_prepayment(db, prepayment, intent_status)

        if outcome is not None:
            audit_log(
                db,
                user=None,
                action="reservation_payment.payment_confirmed",
                entity_type="reservation",
                entity_id=prepayment.reservation_id,
                metadata={
                    "stripe_payment_intent_id": intent_id,
                    "outcome": outcome,
                    "source": "stripe_webhook",
                },
            )

    check_out = db.scalar(
        select(CheckOut).where(CheckOut.stripe_payment_intent_id == intent_id)
    )

    if check_out is not None:
        matched = True

        if apply_payment_intent_status(check_out, intent_status):
            audit_log(
                db,
                user=None,
                action="check_out.payment_confirmed",
                entity_type="check_out",
                entity_id=check_out.id,
                metadata={
                    "payment_method": "CARD",
                    "stripe_payment_intent_id": intent_id,
                    "payment_status": check_out.payment_status,
                    "amount": str(check_out.payment_amount),
                    "source": "stripe_webhook",
                },
            )

    deposit_owner = db.scalar(
        select(Handover).where(Handover.deposit_stripe_payment_intent_id == intent_id)
    )

    if deposit_owner is not None:
        matched = True

        if apply_deposit_intent_status(deposit_owner, intent_status):
            if deposit_owner.deposit_status == "HELD":
                audit_log(
                    db,
                    user=None,
                    action="handover.deposit_held",
                    entity_type="handover",
                    entity_id=deposit_owner.id,
                    metadata={
                        "method": "CARD",
                        "amount": str(deposit_owner.deposit_amount),
                        "stripe_payment_intent_id": intent_id,
                        "source": "stripe_webhook",
                    },
                )

    return matched
