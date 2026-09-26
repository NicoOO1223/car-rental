from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import STRIPE_SECRET_KEY
from app.models import Car, Handover, Reservation, User
from app.services.invoices import issue_credit_note_for_handover, issue_invoice_for_handover
from app.services.money import to_cents
from app.services.stripe_sync import apply_payment_intent_status
from app.services.agreement_pdf import render_agreement_pdf
from app.services.audit import audit_log
from app.services.extras import selections_from_reservation
from app.services.pricing import calculate_price_breakdown
from app.services.configuration import get_configuration, vat_terms
from app.services.identity_details import identity_problem

stripe.api_key = STRIPE_SECRET_KEY

# Card only for now — other methods (MB WAY, Satispay, etc.) can be added
# later once there's a plan for handling their redirect flows.
PAYMENT_METHOD_TYPES = ["card"]


def get_or_create_handover(db: Session, reservation_id, actor: User) -> Handover:
    """
    Fetch the Handover row for a reservation, creating an empty one if
    absent. Only CONFIRMED reservations may have a handover started —
    that's the point in the lifecycle where the customer is expected to
    be physically at the counter.
    """

    handover = db.scalar(
        select(Handover).where(Handover.reservation_id == reservation_id)
    )

    if handover is not None:
        return handover

    reservation = db.get(Reservation, reservation_id)

    if reservation is None:
        raise ValueError("Reservation not found.")

    if reservation.status != "CONFIRMED":
        raise ValueError(
            "Handover is only available for confirmed reservations."
        )

    handover = Handover(
        reservation_id=reservation_id,
        created_by=actor.id,
        updated_by=actor.id,
    )

    db.add(handover)
    db.commit()
    db.refresh(handover)

    return handover


def _require_stripe_configured() -> None:
    if not stripe.api_key:
        raise ValueError(
            "Stripe is not configured on the server. Set STRIPE_SECRET_KEY "
            "in backend/.env to enable payments."
        )


def create_or_reuse_payment_intent(db: Session, reservation_id, actor: User):
    """
    Idempotent: reuses an existing non-canceled PaymentIntent (re-verified
    live against Stripe) rather than creating a duplicate on retry, e.g. a
    page refresh mid-payment. Returns (handover, stripe_intent, breakdown) —
    the raw Stripe object is returned too so the caller can read its
    client_secret without a second Stripe round-trip, and the itemized
    breakdown so the frontend can show it without recomputing the rules.

    The breakdown (and therefore the charge amount) is computed fresh from
    the reservation's *current* dates/locations every time this runs —
    including on reuse — so an edit made after the first payment-intent
    attempt but before payment is still reflected.
    """

    _require_stripe_configured()

    handover = get_or_create_handover(db, reservation_id, actor=actor)

    reservation = db.get(Reservation, reservation_id)
    car = db.get(Car, reservation.car_id)
    configuration = get_configuration(db)

    breakdown = calculate_price_breakdown(
        car.price_per_day,
        reservation.pickup_at,
        reservation.return_at,
        reservation.pickup_location_id,
        reservation.return_location_id,
        short_term_threshold_days=configuration.short_term_threshold_days,
        short_term_fee=configuration.short_term_fee,
        airport_change_fee=configuration.airport_change_fee,
        **vat_terms(configuration),
        # Snapshotted prices, not the live catalog — a booking is charged
        # what it was booked at.
        extras=selections_from_reservation(reservation),
    )

    # Quantized before the cents conversion below. Every input today is an
    # exact 2-dp Decimal multiplied by integers, so int() truncation is
    # currently safe; it stops being obviously safe the moment a
    # percentage-based or prorated extra is added.
    amount = breakdown.total_amount.quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )

    try:
        if handover.stripe_payment_intent_id:
            intent = stripe.PaymentIntent.retrieve(handover.stripe_payment_intent_id)

            if intent.status == "succeeded":
                return handover, intent, breakdown

            if intent.status != "canceled":
                if (
                    list(intent.payment_method_types) == PAYMENT_METHOD_TYPES
                    and intent.amount == to_cents(amount)
                ):
                    return handover, intent, breakdown

                # Payment methods and/or amount changed since this intent was
                # created (e.g. an older intent that used
                # automatic_payment_methods, or the reservation's dates were
                # edited) — Stripe won't let us change payment_method_types
                # in place, and an amount change needs a fresh intent too, so
                # cancel it and create a new one below instead of reusing it.
                stripe.PaymentIntent.cancel(intent.id)

        intent = stripe.PaymentIntent.create(
            amount=to_cents(amount),
            currency=configuration.default_currency,
            payment_method_types=PAYMENT_METHOD_TYPES,
            metadata={"reservation_id": str(reservation_id)},
            # Two clicks (or a retry after a timeout) get the same intent
            # back instead of two charges. The previous intent id is part of
            # the key so that replacing a cancelled intent still creates a
            # new one.
            idempotency_key=(
                f"handover-pi:{reservation_id}:{to_cents(amount)}:"
                f"{handover.stripe_payment_intent_id or 'none'}"
            ),
        )
    except stripe.StripeError as exc:
        raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

    handover.stripe_payment_intent_id = intent.id
    handover.payment_amount = amount
    handover.payment_currency = configuration.default_currency
    handover.payment_status = "PROCESSING"
    handover.payment_method = "CARD"
    handover.updated_by = actor.id

    db.commit()
    db.refresh(handover)

    return handover, intent, breakdown


def confirm_payment(db: Session, reservation_id, actor: User) -> Handover:
    """
    Server-side verification against Stripe — the frontend's own
    stripe.confirmPayment() result is never trusted on its own.
    """

    _require_stripe_configured()

    handover = get_or_create_handover(db, reservation_id, actor=actor)

    if not handover.stripe_payment_intent_id:
        raise ValueError("No payment has been initiated for this reservation.")

    try:
        intent = stripe.PaymentIntent.retrieve(handover.stripe_payment_intent_id)
    except stripe.StripeError as exc:
        raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

    # Shared with the webhook. Never moves a SUCCEEDED or REFUNDED payment
    # backwards, so re-confirming a refunded booking cannot resurrect it.
    apply_payment_intent_status(handover, intent.status)

    handover.updated_by = actor.id

    # A payment that has just succeeded gets its invoice, in this same
    # transaction. Safe if the webhook got there first: issuing is idempotent.
    issue_invoice_for_handover(db, handover, actor)

    audit_log(
        db,
        user=actor,
        action="handover.payment_confirmed",
        entity_type="handover",
        entity_id=handover.id,
        metadata={
            "payment_method": "CARD",
            "stripe_payment_intent_id": handover.stripe_payment_intent_id,
            "payment_status": handover.payment_status,
        },
    )

    db.commit()
    db.refresh(handover)

    return handover


def confirm_cash_payment(db: Session, reservation_id, actor: User) -> Handover:
    """
    Records a cash payment taken at the counter. There's no third party
    to verify this against — unlike confirm_payment(), which re-checks a
    card payment against Stripe, this is a direct staff attestation that
    the full amount was received in cash, made at the moment they take
    it. The amount charged is computed fresh, the same way
    create_or_reuse_payment_intent() does for card, so it reflects the
    reservation's current dates/locations/extras.
    """

    handover = get_or_create_handover(db, reservation_id, actor=actor)

    reservation = db.get(Reservation, reservation_id)
    car = db.get(Car, reservation.car_id)
    configuration = get_configuration(db)

    breakdown = calculate_price_breakdown(
        car.price_per_day,
        reservation.pickup_at,
        reservation.return_at,
        reservation.pickup_location_id,
        reservation.return_location_id,
        short_term_threshold_days=configuration.short_term_threshold_days,
        short_term_fee=configuration.short_term_fee,
        airport_change_fee=configuration.airport_change_fee,
        **vat_terms(configuration),
        extras=selections_from_reservation(reservation),
    )

    amount = breakdown.total_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    handover.payment_amount = amount
    handover.payment_currency = configuration.default_currency
    handover.payment_status = "SUCCEEDED"
    handover.payment_method = "CASH"
    handover.paid_at = datetime.now(timezone.utc)
    handover.updated_by = actor.id

    issue_invoice_for_handover(db, handover, actor)

    audit_log(
        db,
        user=actor,
        action="handover.payment_confirmed",
        entity_type="handover",
        entity_id=handover.id,
        metadata={
            "payment_method": "CASH",
            "payment_status": handover.payment_status,
        },
    )

    db.commit()
    db.refresh(handover)

    return handover


def refund_handover_if_paid(db: Session, reservation_id, actor: User) -> Handover | None:
    """
    Called from cancel_reservation() (app/services/reservations.py) when
    a reservation is cancelled. Refunds the full payment_amount if this
    reservation's handover shows a SUCCEEDED payment — a CARD payment
    gets a real Stripe refund against the original PaymentIntent, a CASH
    payment is recorded as a staff attestation, the same reasoning
    confirm_cash_payment() uses for taking cash in the first place.
    Returns the updated Handover, or None if there was nothing to
    refund (no handover yet, or payment_status isn't SUCCEEDED — a
    still-PROCESSING or never-attempted payment has nothing captured to
    give back).

    Never commits — the caller commits this together with the
    reservation's own status change, so a refund is never recorded
    without the cancellation it belongs to actually going through.
    """

    handover = db.scalar(
        select(Handover).where(Handover.reservation_id == reservation_id)
    )

    if handover is None or handover.payment_status != "SUCCEEDED":
        return None

    if handover.payment_method == "CARD":
        _require_stripe_configured()

        try:
            refund = stripe.Refund.create(
                payment_intent=handover.stripe_payment_intent_id,
                # One refund per handover, however many times the
                # cancellation is retried.
                idempotency_key=f"handover-refund:{handover.id}",
            )
        except stripe.StripeError as exc:
            raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

        handover.stripe_refund_id = refund.id

    handover.refund_amount = handover.payment_amount
    handover.refunded_at = datetime.now(timezone.utc)
    handover.payment_status = "REFUNDED"
    handover.updated_by = actor.id

    # The invoice is reversed with a credit note rather than altered.
    issue_credit_note_for_handover(db, handover, actor)

    audit_log(
        db,
        user=actor,
        action="handover.refund_issued",
        entity_type="handover",
        entity_id=handover.id,
        metadata={
            "amount": float(handover.refund_amount),
            "currency": handover.payment_currency,
            "method": handover.payment_method,
            "reservation_id": str(reservation_id),
        },
    )

    return handover


def submit_signature(
    db: Session, reservation_id, signature_image: str, actor: User
) -> Handover:
    handover = get_or_create_handover(db, reservation_id, actor=actor)

    handover.signature_image = signature_image
    handover.signed_at = datetime.now(timezone.utc)
    handover.updated_by = actor.id

    db.commit()
    db.refresh(handover)

    return handover


def submit_employee_signature(
    db: Session, reservation_id, signature_image: str, actor: User
) -> Handover:
    """
    The approving employee signs after the customer. The signer is the
    authenticated user making the request.
    """

    handover = get_or_create_handover(db, reservation_id, actor=actor)

    if not handover.signature_image:
        raise ValueError("The customer must sign before the employee.")

    reservation = db.get(Reservation, reservation_id)

    if reservation.status != "CONFIRMED":
        raise ValueError(
            f"Cannot sign for a {reservation.status.lower()} reservation."
        )

    handover.employee_signature_image = signature_image
    handover.employee_signed_at = datetime.now(timezone.utc)
    handover.employee_signed_by = actor.id
    handover.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="handover.employee_signed",
        entity_type="handover",
        entity_id=handover.id,
        metadata={"reservation_id": str(reservation_id)},
    )

    db.commit()
    db.refresh(handover)

    return handover


def generate_agreement(db: Session, reservation_id, actor: User) -> Handover:
    """
    Validates payment SUCCEEDED + signature present, generates the PDF,
    and — all in one transaction — sets Reservation.status = ACTIVE and
    Car.status = RENTED. This is the only path by which a reservation
    reaches ACTIVE.
    """

    handover = get_or_create_handover(db, reservation_id, actor=actor)

    if handover.payment_status != "SUCCEEDED":
        raise ValueError("Payment must be completed before generating the agreement.")

    if (
        get_configuration(db).security_deposit_amount > 0
        and handover.deposit_status != "HELD"
    ):
        raise ValueError(
            "A security deposit is required before generating the agreement."
        )

    if not handover.signature_image:
        raise ValueError("Customer signature is required before generating the agreement.")

    if not handover.employee_signature_image:
        raise ValueError("Employee signature is required before generating the agreement.")

    reservation = db.get(Reservation, reservation_id)

    problem = identity_problem(reservation.customer, reservation.return_at)

    if problem is not None:
        raise ValueError(f"Identity check incomplete: {problem}")

    if reservation.status != "CONFIRMED":
        raise ValueError(
            f"Cannot generate agreement for a {reservation.status.lower()} reservation."
        )

    car = db.get(Car, reservation.car_id)

    pdf_bytes = render_agreement_pdf(db, reservation, car, handover)

    handover.agreement_pdf = pdf_bytes
    handover.generated_at = datetime.now(timezone.utc)
    handover.updated_by = actor.id
    reservation.status = "ACTIVE"
    reservation.updated_by = actor.id
    car.status = "RENTED"

    audit_log(
        db,
        user=actor,
        action="handover.agreement_generated",
        entity_type="handover",
        entity_id=handover.id,
        metadata={"reservation_id": str(reservation.id)},
    )

    db.commit()
    db.refresh(handover)

    return handover
