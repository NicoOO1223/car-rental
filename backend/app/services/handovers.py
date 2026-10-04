from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.permissions import WRITE, has_permission
from app.services.availability import lock_reservation
from app.services.stripe_errors import stripe_app_error
from app.errors import AppError, NotFoundError
from app.config import STRIPE_SECRET_KEY
from app.models import Car, Handover, Reservation, User
from app.services.invoices import issue_credit_note_for_handover, issue_invoice_for_handover
from app.services.money import to_cents
from app.services.stripe_sync import apply_payment_intent_status
from app.services.agreement_pdf import render_agreement_pdf
from app.services.audit import audit_log
from app.services.extras import selections_from_reservation
from app.services.booking_prices import reservation_price_breakdown
from app.services.prepayments import prepaid_amount
from app.services.configuration import get_configuration, vat_terms
from app.services.identity_details import identity_issue

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
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    if reservation.status != "CONFIRMED":
        raise AppError("handover.handover_only_available_confirmed_reservations", "Handover is only available for confirmed reservations.")

    handover = Handover(
        reservation_id=reservation_id,
        created_by=actor.id,
        updated_by=actor.id,
    )

    db.add(handover)
    db.commit()
    db.refresh(handover)

    return handover


def get_handover_for_viewing(db: Session, reservation_id, actor: User) -> Handover:
    """
    The handover to show. Opening the check-in screen starts a handover (an empty
    row) for someone who works the counter; an account that can only look must not
    cause that write, so for them a handover that was never started is simply not
    found.
    """

    if has_permission(actor.role, WRITE):
        return get_or_create_handover(db, reservation_id, actor=actor)

    handover = db.scalar(select(Handover).where(Handover.reservation_id == reservation_id))

    if handover is None:
        raise NotFoundError("handover.not_started", "No handover has been started for this reservation.")

    return handover


def get_open_handover(db: Session, reservation_id, actor: User) -> Handover:
    """
    The handover for an action that changes it (a payment, a signature, a
    deposit). Only a CONFIRMED reservation is still at the counter: a cancelled
    one must not take money or collect a signature, and a rental already in
    progress must not have its signature replaced after the agreement was made.

    The reservation row is locked until the transaction ends, so this and a
    cancellation of the same booking run one after the other instead of both
    passing their checks.
    """

    reservation = lock_reservation(db, reservation_id)

    if reservation is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    if reservation.status != "CONFIRMED":
        raise AppError(
            "handover.cannot_change_status",
            f"The handover of a {reservation.status.lower()} reservation cannot be changed.",
            status=reservation.status,
        )

    return get_or_create_handover(db, reservation_id, actor=actor)


def amount_due(db: Session, reservation_id, breakdown) -> Decimal:
    """
    What is still to be paid at the counter: the whole price less what the
    renter paid online. Raises when nothing is left, because a rental paid in
    full online is settled with settle_prepaid_handover, not by taking money.
    """

    total = breakdown.total_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    due = total - prepaid_amount(db, reservation_id)

    if due <= 0:
        raise AppError(
            "handover.nothing_due",
            "This rental was paid in full online. Settle it as paid instead of taking a payment.",
        )

    return due


def payment_summary(db: Session, reservation_id) -> dict:
    """What the counter screen needs to say about money: the whole price, what
    the renter already paid online, and what is left to take now."""

    reservation = db.get(Reservation, reservation_id)

    if reservation is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    car = db.get(Car, reservation.car_id)
    configuration = get_configuration(db)
    breakdown = reservation_price_breakdown(db, reservation, car, configuration)
    total = breakdown.total_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    online = prepaid_amount(db, reservation_id)

    return {
        "currency": configuration.default_currency,
        "total_amount": total,
        "paid_online": online,
        "amount_due": max(total - online, Decimal("0.00")),
    }


def settle_prepaid_handover(db: Session, reservation_id, actor: User) -> Handover:
    """
    Records that a rental paid in full online needs no payment at the counter,
    so check-in can continue. The counter payment is PREPAID, for nothing.
    """

    handover = get_open_handover(db, reservation_id, actor=actor)

    if handover.payment_status == "SUCCEEDED":
        return handover

    reservation = db.get(Reservation, reservation_id)
    car = db.get(Car, reservation.car_id)
    configuration = get_configuration(db)
    breakdown = reservation_price_breakdown(db, reservation, car, configuration)
    total = breakdown.total_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    if prepaid_amount(db, reservation_id) < total:
        raise AppError(
            "handover.not_fully_prepaid",
            "This rental has not been paid in full online, so a payment is still due.",
        )

    handover.payment_amount = Decimal("0.00")
    handover.payment_currency = configuration.default_currency
    handover.payment_method = "PREPAID"
    handover.payment_status = "SUCCEEDED"
    handover.paid_at = datetime.now(timezone.utc)
    handover.updated_by = actor.id

    audit_log(
        db,
        user=actor,
        action="handover.payment_confirmed",
        entity_type="handover",
        entity_id=handover.id,
        metadata={"payment_method": "PREPAID", "payment_status": handover.payment_status},
    )

    db.commit()
    db.refresh(handover)

    return handover


def _require_stripe_configured() -> None:
    if not stripe.api_key:
        raise AppError("stripe.not_configured", "Stripe is not configured on the server. Set STRIPE_SECRET_KEY "
            "in backend/.env to enable payments.")


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

    handover = get_open_handover(db, reservation_id, actor=actor)

    # Paid in cash already: a card payment for the same rental would charge the
    # customer twice.
    if handover.payment_status == "SUCCEEDED" and not handover.stripe_payment_intent_id:
        raise AppError("handover.payment_already_taken", "This rental has already been paid.")

    reservation = db.get(Reservation, reservation_id)
    car = db.get(Car, reservation.car_id)
    configuration = get_configuration(db)

    breakdown = reservation_price_breakdown(db, reservation, car, configuration)

    # Quantized before the cents conversion below. Every input today is an
    # exact 2-dp Decimal multiplied by integers, so int() truncation is
    # currently safe; it stops being obviously safe the moment a
    # percentage-based or prorated extra is added.
    amount = amount_due(db, reservation_id, breakdown)

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
        raise stripe_app_error(exc)

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

    handover = get_open_handover(db, reservation_id, actor=actor)

    if not handover.stripe_payment_intent_id:
        raise AppError("handover.no_payment_initiated_reservation", "No payment has been initiated for this reservation.")

    try:
        intent = stripe.PaymentIntent.retrieve(handover.stripe_payment_intent_id)
    except stripe.StripeError as exc:
        raise stripe_app_error(exc)

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

    handover = get_open_handover(db, reservation_id, actor=actor)

    # A second payment would overwrite the first, and a card payment relabelled
    # as cash could never be refunded through Stripe.
    if handover.payment_status == "SUCCEEDED":
        raise AppError("handover.payment_already_taken", "This rental has already been paid.")

    # A card payment that was started and not finished is closed first, so it
    # cannot be completed later on top of the cash. If Stripe says it already
    # went through, the customer has paid: the card payment has to be
    # confirmed instead.
    if handover.stripe_payment_intent_id and stripe.api_key:
        try:
            open_intent = stripe.PaymentIntent.retrieve(handover.stripe_payment_intent_id)

            if open_intent.status == "succeeded":
                raise AppError(
                    "handover.card_payment_already_succeeded",
                    "The customer has already paid by card. Confirm the card payment instead of taking cash.",
                )

            if open_intent.status != "canceled":
                stripe.PaymentIntent.cancel(open_intent.id)
        except stripe.StripeError as exc:
            raise stripe_app_error(exc)

    reservation = db.get(Reservation, reservation_id)
    car = db.get(Car, reservation.car_id)
    configuration = get_configuration(db)

    breakdown = reservation_price_breakdown(db, reservation, car, configuration)

    amount = amount_due(db, reservation_id, breakdown)

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


def _close_unfinished_card_payment(db: Session, handover: Handover, actor: User | None) -> None:
    """
    A card payment that was started and never finished (PROCESSING, or FAILED
    and still retryable) is cancelled at Stripe, so the customer cannot pay it
    after the booking is gone. If Stripe says they paid in the meantime, that
    payment is recorded and invoiced here, and the caller refunds it like any
    other paid handover.
    """

    if (
        handover.payment_method != "CARD"
        or handover.payment_status not in ("PROCESSING", "FAILED")
        or not handover.stripe_payment_intent_id
    ):
        return

    _require_stripe_configured()

    try:
        intent = stripe.PaymentIntent.retrieve(handover.stripe_payment_intent_id)

        if intent.status == "succeeded":
            apply_payment_intent_status(handover, "succeeded")
            issue_invoice_for_handover(db, handover, actor)
        elif intent.status == "canceled":
            apply_payment_intent_status(handover, "canceled")
        else:
            stripe.PaymentIntent.cancel(intent.id)
            handover.payment_status = "CANCELLED"
    except stripe.StripeError as exc:
        raise stripe_app_error(exc)


def refund_handover_if_paid(db: Session, reservation_id, actor: User | None) -> Handover | None:
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

    if handover is not None:
        _close_unfinished_card_payment(db, handover, actor)

    if handover is None or handover.payment_status != "SUCCEEDED":
        return None

    # Paid in full online: there is no counter payment to give back; the
    # online share is settled separately (services/prepayments.py).
    if handover.payment_method == "PREPAID":
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
            raise stripe_app_error(exc)

        handover.stripe_refund_id = refund.id

    handover.refund_amount = handover.payment_amount
    handover.refunded_at = datetime.now(timezone.utc)
    handover.payment_status = "REFUNDED"
    handover.updated_by = actor.id if actor else None

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
    handover = get_open_handover(db, reservation_id, actor=actor)

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
        raise AppError("handover.customer_must_sign_before_employee", "The customer must sign before the employee.")

    reservation = db.get(Reservation, reservation_id)

    if reservation.status != "CONFIRMED":
        raise AppError(
            "handover.cannot_sign_status",
            f"Cannot sign for a {reservation.status.lower()} reservation.",
            status=reservation.status,
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
        raise AppError("handover.payment_must_completed_before_generating_agreement", "Payment must be completed before generating the agreement.")

    if (
        get_configuration(db).security_deposit_amount > 0
        and handover.deposit_status != "HELD"
    ):
        raise AppError("handover.security_deposit_required_before_generating_agreement", "A security deposit is required before generating the agreement.")

    if not handover.signature_image:
        raise AppError("handover.customer_signature_required_before_generating_agreement", "Customer signature is required before generating the agreement.")

    if not handover.employee_signature_image:
        raise AppError("handover.employee_signature_required_before_generating_agreement", "Employee signature is required before generating the agreement.")

    reservation = db.get(Reservation, reservation_id)

    issue = identity_issue(reservation.customer, reservation.return_at)

    if issue is not None:
        raise AppError(
            "handover.identity_incomplete",
            f"Identity check incomplete: {issue.message}",
            # The nested reason has its own translation.
            problem_code=issue.code,
        )

    if reservation.status != "CONFIRMED":
        raise AppError(
            "handover.cannot_generate_status",
            f"Cannot generate agreement for a {reservation.status.lower()} reservation.",
            status=reservation.status,
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
