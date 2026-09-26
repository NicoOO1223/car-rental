"""
Security deposit, taken at check-in and settled at check-out.

A card deposit is a Stripe authorization with manual capture: the amount is
reserved on the customer's card but not charged, and at check-out either
part of it is captured for return charges (and the rest released by Stripe)
or the whole authorization is cancelled. A cash deposit is a staff
attestation that the money was taken, like cash payments elsewhere.

Settling against the return charges lives in app/services/check_outs.py.
"""

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.stripe_errors import stripe_app_error
from app.errors import AppError
from app.models import Handover, User
from app.services.audit import audit_log
from app.services.money import to_cents as _cents
from app.services.configuration import get_configuration
from app.services.handovers import (
    _require_stripe_configured,
    get_or_create_handover,
)

_CENTS = Decimal("0.01")

# The hold can't be replaced or re-taken once it is in one of these.
_HOLD_ACTIVE = ("HELD",)


def _require_deposit_stage(db: Session, handover: Handover) -> Decimal:
    """The configured amount, after checking a deposit can be taken now."""

    amount = get_configuration(db).security_deposit_amount

    if amount <= 0 and handover.deposit_status is None:
        raise AppError("deposit.security_deposits_are_not_enabled", "Security deposits are not enabled.")

    if handover.deposit_status in _HOLD_ACTIVE:
        raise AppError("deposit.security_deposit_already_held", "The security deposit is already held.")

    if handover.deposit_status is not None and handover.deposit_settled_at is not None:
        raise AppError("deposit.deposit_already_settled", "This deposit has already been settled.")

    if handover.payment_status != "SUCCEEDED":
        raise AppError("deposit.take_rental_payment_before_security_deposit", "Take the rental payment before the security deposit.")

    return Decimal(amount).quantize(_CENTS)


def create_or_reuse_deposit_intent(db: Session, reservation_id: UUID, actor: User):
    """Starts (or resumes) the card authorization for the deposit."""

    _require_stripe_configured()

    handover = get_or_create_handover(db, reservation_id, actor=actor)
    amount = _require_deposit_stage(db, handover)

    if handover.deposit_amount is not None and handover.deposit_status == "PENDING":
        # A retry keeps the amount it started with unless it was changed.
        amount = Decimal(handover.deposit_amount)

    configuration = get_configuration(db)

    try:
        if handover.deposit_stripe_payment_intent_id:
            intent = stripe.PaymentIntent.retrieve(
                handover.deposit_stripe_payment_intent_id
            )

            if intent.status == "requires_capture":
                return handover, intent

            if intent.status != "canceled":
                if (
                    intent.amount == _cents(amount)
                    and intent.capture_method == "manual"
                ):
                    return handover, intent

                stripe.PaymentIntent.cancel(intent.id)

        intent = stripe.PaymentIntent.create(
            amount=_cents(amount),
            currency=configuration.default_currency,
            payment_method_types=["card"],
            capture_method="manual",
            metadata={"reservation_id": str(reservation_id), "kind": "deposit"},
            idempotency_key=(
                f"deposit-pi:{reservation_id}:{_cents(amount)}:"
                f"{handover.deposit_stripe_payment_intent_id or 'none'}"
            ),
        )
    except stripe.StripeError as exc:
        raise stripe_app_error(exc)

    handover.deposit_stripe_payment_intent_id = intent.id
    handover.deposit_amount = amount
    handover.deposit_currency = configuration.default_currency
    handover.deposit_method = "CARD"
    handover.deposit_status = "PENDING"
    handover.updated_by = actor.id

    db.commit()
    db.refresh(handover)

    return handover, intent


def confirm_deposit_hold(db: Session, reservation_id: UUID, actor: User) -> Handover:
    """Verifies with Stripe that the card authorization actually succeeded."""

    _require_stripe_configured()

    handover = get_or_create_handover(db, reservation_id, actor=actor)

    if not handover.deposit_stripe_payment_intent_id:
        raise AppError("deposit.no_deposit_started_reservation", "No deposit has been started for this reservation.")

    try:
        intent = stripe.PaymentIntent.retrieve(handover.deposit_stripe_payment_intent_id)
    except stripe.StripeError as exc:
        raise stripe_app_error(exc)

    if intent.status == "requires_capture":
        if handover.deposit_status != "HELD":
            handover.deposit_status = "HELD"
            handover.deposit_held_at = datetime.now(timezone.utc)

            audit_log(
                db,
                user=actor,
                action="handover.deposit_held",
                entity_type="handover",
                entity_id=handover.id,
                metadata={
                    "method": "CARD",
                    "amount": str(handover.deposit_amount),
                    "stripe_payment_intent_id": handover.deposit_stripe_payment_intent_id,
                },
            )
    elif intent.status == "canceled":
        handover.deposit_status = "CANCELLED"

    handover.updated_by = actor.id

    db.commit()
    db.refresh(handover)

    return handover


def confirm_cash_deposit(db: Session, reservation_id: UUID, actor: User) -> Handover:
    """A staff attestation that the deposit was received in cash."""

    handover = get_or_create_handover(db, reservation_id, actor=actor)
    amount = _require_deposit_stage(db, handover)
    configuration = get_configuration(db)

    # A card authorization that was started but never completed is dropped.
    if handover.deposit_stripe_payment_intent_id and stripe.api_key:
        try:
            stripe.PaymentIntent.cancel(handover.deposit_stripe_payment_intent_id)
        except stripe.StripeError:
            pass

    handover.deposit_stripe_payment_intent_id = None
    handover.deposit_amount = amount
    handover.deposit_currency = configuration.default_currency
    handover.deposit_method = "CASH"
    handover.deposit_status = "HELD"
    handover.deposit_held_at = datetime.now(timezone.utc)
    handover.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="handover.deposit_held",
        entity_type="handover",
        entity_id=handover.id,
        metadata={"method": "CASH", "amount": str(amount)},
    )

    db.commit()
    db.refresh(handover)

    return handover


def release_deposit_for_cancellation(
    db: Session, reservation_id: UUID, actor: User
) -> Handover | None:
    """
    Called when a reservation is cancelled: a held card authorization is
    cancelled so the customer's card is freed, and a held cash deposit is
    marked returned. Never commits; the caller commits with the
    cancellation, so a booking is never cancelled with its hold left in
    place (or the reverse).
    """

    handover = db.scalar(select(Handover).where(Handover.reservation_id == reservation_id))

    if handover is None or handover.deposit_status not in ("PENDING", "HELD"):
        return None

    if handover.deposit_method == "CARD" and handover.deposit_stripe_payment_intent_id:
        _require_stripe_configured()

        try:
            stripe.PaymentIntent.cancel(handover.deposit_stripe_payment_intent_id)
        except stripe.StripeError as exc:
            # Already released or expired on Stripe's side is fine.
            if getattr(exc, "code", None) not in (
                "payment_intent_unexpected_state",
                "resource_missing",
            ):
                raise stripe_app_error(exc)

    was_held = handover.deposit_status == "HELD"

    handover.deposit_status = "RELEASED" if was_held else "CANCELLED"
    handover.deposit_captured_amount = Decimal("0.00")
    handover.deposit_settled_at = datetime.now(timezone.utc)
    handover.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="handover.deposit_released",
        entity_type="handover",
        entity_id=handover.id,
        metadata={
            "reason": "reservation_cancelled",
            "method": handover.deposit_method,
            "amount": str(handover.deposit_amount),
        },
    )

    return handover
