from datetime import datetime

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import STRIPE_SECRET_KEY
from app.models import Car, Handover, Reservation
from app.services.agreement_pdf import render_agreement_pdf
from app.services.pricing import calculate_price_breakdown

stripe.api_key = STRIPE_SECRET_KEY

# Card only for now — other methods (MB WAY, Satispay, etc.) can be added
# later once there's a plan for handling their redirect flows.
PAYMENT_METHOD_TYPES = ["card"]


def get_or_create_handover(db: Session, reservation_id) -> Handover:
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

    handover = Handover(reservation_id=reservation_id)

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


def create_or_reuse_payment_intent(db: Session, reservation_id):
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

    handover = get_or_create_handover(db, reservation_id)

    reservation = db.get(Reservation, reservation_id)
    car = db.get(Car, reservation.car_id)

    breakdown = calculate_price_breakdown(
        car.price_per_day,
        reservation.pickup_at,
        reservation.return_at,
        reservation.pickup_location_id,
        reservation.return_location_id,
    )
    amount = breakdown.total_amount

    try:
        if handover.stripe_payment_intent_id:
            intent = stripe.PaymentIntent.retrieve(handover.stripe_payment_intent_id)

            if intent.status == "succeeded":
                return handover, intent, breakdown

            if intent.status != "canceled":
                if (
                    list(intent.payment_method_types) == PAYMENT_METHOD_TYPES
                    and intent.amount == int(amount * 100)
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
            amount=int(amount * 100),
            currency="eur",
            payment_method_types=PAYMENT_METHOD_TYPES,
            metadata={"reservation_id": str(reservation_id)},
        )
    except stripe.StripeError as exc:
        raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

    handover.stripe_payment_intent_id = intent.id
    handover.payment_amount = amount
    handover.payment_currency = "eur"
    handover.payment_status = "PROCESSING"

    db.commit()
    db.refresh(handover)

    return handover, intent, breakdown


def confirm_payment(db: Session, reservation_id) -> Handover:
    """
    Server-side verification against Stripe — the frontend's own
    stripe.confirmPayment() result is never trusted on its own.
    """

    _require_stripe_configured()

    handover = get_or_create_handover(db, reservation_id)

    if not handover.stripe_payment_intent_id:
        raise ValueError("No payment has been initiated for this reservation.")

    try:
        intent = stripe.PaymentIntent.retrieve(handover.stripe_payment_intent_id)
    except stripe.StripeError as exc:
        raise ValueError(f"Stripe error: {exc.user_message or str(exc)}")

    if intent.status == "succeeded":
        handover.payment_status = "SUCCEEDED"
        handover.paid_at = datetime.utcnow()
    elif intent.status == "processing":
        handover.payment_status = "PROCESSING"
    elif intent.status == "canceled":
        handover.payment_status = "CANCELLED"
    else:
        handover.payment_status = "FAILED"

    db.commit()
    db.refresh(handover)

    return handover


def submit_signature(db: Session, reservation_id, signature_image: str) -> Handover:
    handover = get_or_create_handover(db, reservation_id)

    handover.signature_image = signature_image
    handover.signed_at = datetime.utcnow()

    db.commit()
    db.refresh(handover)

    return handover


def generate_agreement(db: Session, reservation_id) -> Handover:
    """
    Validates payment SUCCEEDED + signature present, generates the PDF,
    and — all in one transaction — sets Reservation.status = ACTIVE and
    Car.status = RENTED. This is the only path by which a reservation
    reaches ACTIVE.
    """

    handover = get_or_create_handover(db, reservation_id)

    if handover.payment_status != "SUCCEEDED":
        raise ValueError("Payment must be completed before generating the agreement.")

    if not handover.signature_image:
        raise ValueError("Customer signature is required before generating the agreement.")

    reservation = db.get(Reservation, reservation_id)

    if reservation.status != "CONFIRMED":
        raise ValueError(
            f"Cannot generate agreement for a {reservation.status.lower()} reservation."
        )

    car = db.get(Car, reservation.car_id)

    pdf_bytes = render_agreement_pdf(reservation, car, handover)

    handover.agreement_pdf = pdf_bytes
    handover.generated_at = datetime.utcnow()
    reservation.status = "ACTIVE"
    car.status = "RENTED"

    db.commit()
    db.refresh(handover)

    return handover
