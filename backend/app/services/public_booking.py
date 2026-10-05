"""
Booking a car from the public storefront.

The flow, in the order things happen:

  1. create_booking picks a free car of the chosen offer, holds it for a few
     minutes (status AWAITING_PAYMENT), and starts a Stripe payment for the
     online share. The renter is a brand new customer every time.
  2. The payment completes in the browser. Three things can notice: Stripe's
     webhook, the renter's browser calling sync-payment, and the sweeper. All
     of them end in on_prepayment_succeeded, which is safe to run any number
     of times and is the only place a booking becomes CONFIRMED.
  3. A hold that is never paid runs out. The car is free again the moment it
     does (the blocking clause ignores expired holds), and the sweeper tidies
     the booking up: EXPIRED, its Stripe payment cancelled.

Stripe is never called while a car is locked: the hold is committed first.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import stripe
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import SECRET_KEY, STRIPE_SECRET_KEY
from app.errors import AppError, ConflictError
from app.models import Customer, Reservation, ReservationPayment
from app.services.audit import audit_log
from app.services.email_outbox import queue_booking_confirmed
from app.services.availability import (
    has_conflicting_maintenance,
    has_conflicting_reservation,
    lock_car,
    projected_location_id,
)
from app.services.booking_prices import stamp_agreed_prices
from app.services.extras import build_reservation_extras, resolve_extra_selections
from app.services.invoices import issue_invoice_for_prepayment
from app.services.money import to_cents
from app.services.prepayments import refund_prepayment
from app.services.public_catalog import (
    cancellation_deadline,
    cars_for_offer,
    offer_key,
    require_locations,
    require_storefront_enabled,
    split_payment,
    validate_window,
)
from app.services.stripe_errors import stripe_app_error
from app.services.stripe_sync import apply_payment_intent_status
from app.services.turnstile import require_human

logger = logging.getLogger(__name__)

stripe.api_key = STRIPE_SECRET_KEY

# Live unpaid holds one address, one email address, and the whole business may
# have at once. They stop someone from tying up the fleet by starting bookings
# they never pay for, and they are counted in the database so a restart does
# not reset them.
MAX_HOLDS_PER_IP = 3
MAX_HOLDS_PER_EMAIL = 2
MAX_HOLDS_TOTAL = 100

# No 0, O, 1, I or L: a reference is read out and typed in by people.
_REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def new_reference() -> str:
    letters = "".join(secrets.choice(_REFERENCE_ALPHABET) for _ in range(8))

    return f"{letters[:4]}-{letters[4:]}"


def normalize_reference(text: str) -> str:
    """What a renter typed, as stored: upper case with the dash in place."""

    compact = "".join(ch for ch in text.upper() if ch.isalnum())

    return f"{compact[:4]}-{compact[4:]}" if len(compact) == 8 else text.strip().upper()


def hash_ip(ip: str) -> str:
    """A keyed hash: enough to count holds per address, not to recover it."""

    return hmac.new(SECRET_KEY.encode(), b"ip|" + ip.encode(), hashlib.sha256).hexdigest()[:32]


def _live_holds(now: datetime):
    return (Reservation.status == "AWAITING_PAYMENT", Reservation.hold_expires_at > now)


def enforce_hold_caps(db: Session, ip_hash: str, email: str, now: datetime) -> None:
    def too_many():
        return AppError(
            "public.too_many_bookings",
            "You have too many bookings waiting for payment. Finish or wait for them to expire.",
            status_code=429,
        )

    if db.scalar(select(func.count(Reservation.id)).where(*_live_holds(now))) >= MAX_HOLDS_TOTAL:
        raise AppError(
            "public.busy", "Online booking is very busy right now. Please try again shortly.", status_code=503
        )

    per_ip = db.scalar(
        select(func.count(Reservation.id)).where(*_live_holds(now), Reservation.client_ip_hash == ip_hash)
    )

    if per_ip >= MAX_HOLDS_PER_IP:
        raise too_many()

    per_email = db.scalar(
        select(func.count(Reservation.id))
        .join(Customer, Customer.id == Reservation.customer_id)
        .where(*_live_holds(now), func.lower(Customer.email) == email.lower())
    )

    if per_email >= MAX_HOLDS_PER_EMAIL:
        raise too_many()


def _require_stripe() -> None:
    if not stripe.api_key:
        raise AppError(
            "stripe.not_configured",
            "Stripe is not configured on the server. Set STRIPE_SECRET_KEY "
            "in backend/.env to enable payments.",
            status_code=503,
        )


def _pick_and_lock_car(db: Session, candidates, data, resolved_pickup_at, resolved_return_at):
    """The first candidate that is still free once it is locked."""

    for car in candidates:
        lock_car(db, car.id)

        if (
            projected_location_id(db, car, resolved_pickup_at) == data.pickup_location_id
            and not has_conflicting_reservation(db, car.id, resolved_pickup_at, resolved_return_at)
            and not has_conflicting_maintenance(db, car.id, resolved_pickup_at, resolved_return_at)
        ):
            return car

    return None


def create_booking(db: Session, data, configuration, ip: str) -> tuple[Reservation, ReservationPayment, str, Decimal, Decimal]:
    """
    Holds a car for the renter and starts the payment of the online share.
    Returns (reservation, payment, stripe client secret, online amount, amount
    left for pickup).
    """

    now = datetime.now(timezone.utc)

    require_storefront_enabled(configuration)
    validate_window(configuration, data.pickup_at, data.return_at, now=now)
    require_locations(db, data.pickup_location_id, data.return_location_id)

    if not (data.terms_accepted and data.privacy_acknowledged):
        raise AppError("public.terms_required", "Please accept the terms and acknowledge the privacy notice to book.")

    require_human(data.captcha_token, ip)
    _require_stripe()

    ip_hash = hash_ip(ip)
    email = data.customer.email.strip()

    enforce_hold_caps(db, ip_hash, email, now)

    candidates = cars_for_offer(db, data.offer_key, data.pickup_location_id, data.pickup_at, data.return_at)

    if not candidates:
        raise ConflictError("public.offer_unavailable", "This car is no longer available for these dates.")

    resolved_extras = resolve_extra_selections(db, data.extras)

    car = _pick_and_lock_car(db, candidates, data, data.pickup_at, data.return_at)

    if car is None:
        db.rollback()
        raise ConflictError("public.offer_unavailable", "This car is no longer available for these dates.")

    customer = Customer(
        first_name=data.customer.first_name,
        last_name=data.customer.last_name,
        date_of_birth=data.customer.date_of_birth,
        address=data.customer.address,
        postal_code=data.customer.postal_code,
        phone_number=data.customer.phone_number,
        email=email,
        nationality=data.customer.nationality,
        terms_accepted_at=now,
        terms_version=configuration.legal_version,
        privacy_acknowledged_at=now,
        privacy_version=configuration.legal_version,
    )

    reservation = Reservation(
        car_id=car.id,
        pickup_location_id=data.pickup_location_id,
        return_location_id=data.return_location_id,
        pickup_at=data.pickup_at,
        return_at=data.return_at,
        status="AWAITING_PAYMENT",
        source="STOREFRONT",
        language=data.language,
        hold_expires_at=now + timedelta(minutes=configuration.hold_minutes),
        prepayment_percent=configuration.online_share_percent,
        cancellation_deadline_at=cancellation_deadline(configuration, data.pickup_at),
        client_ip_hash=ip_hash,
        extras=build_reservation_extras(resolved_extras),
    )
    reservation.customer = customer

    breakdown = stamp_agreed_prices(db, reservation, car, configuration)
    total = reservation.agreed_total_amount

    # What the renter saw is what they pay: if anything moved since (a rate, a
    # fee, an add-on's price) they are told, and nothing is held.
    if Decimal(str(data.expected_total)).quantize(Decimal("0.01")) != total:
        db.rollback()
        raise ConflictError(
            "public.price_changed",
            "The price has changed. Please review the new total.",
            new_total=str(total),
        )

    online, at_pickup = split_payment(total, configuration.online_share_percent)

    # A reference is random; on the rare clash, draw another.
    for _ in range(5):
        reservation.public_reference = new_reference()

        try:
            with db.begin_nested():
                db.add(reservation)
                db.flush()

            break
        except IntegrityError:
            continue
    else:
        db.rollback()
        raise AppError("public.try_again", "Something went wrong. Please try again.", status_code=503)

    audit_log(
        db,
        user=None,
        action="reservation.created",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"car_id": str(car.id), "source": "storefront", "reference": reservation.public_reference},
    )

    # The hold is committed (and the car unlocked) before Stripe is called.
    db.commit()

    try:
        intent = stripe.PaymentIntent.create(
            amount=to_cents(online),
            currency=configuration.default_currency,
            payment_method_types=["card"],
            receipt_email=email,
            description=f"Car rental {reservation.public_reference}",
            metadata={"reservation_id": str(reservation.id), "reference": reservation.public_reference},
            idempotency_key=f"public-pi:{reservation.id}",
        )
    except stripe.StripeError as exc:
        release_hold(db, reservation.id, now)
        raise stripe_app_error(exc)

    payment = ReservationPayment(
        reservation_id=reservation.id,
        kind="PREPAYMENT",
        payment_method="CARD",
        payment_amount=online,
        payment_currency=configuration.default_currency,
        payment_status="PROCESSING",
        stripe_payment_intent_id=intent.id,
    )
    db.add(payment)
    db.commit()
    db.refresh(reservation)

    return reservation, payment, intent.client_secret, online, at_pickup


def release_hold(db: Session, reservation_id, now: datetime) -> None:
    """Gives up a hold that never got as far as a payment, or whose payment failed to start."""

    reservation = db.get(Reservation, reservation_id)

    if reservation is not None and reservation.status == "AWAITING_PAYMENT":
        reservation.status = "EXPIRED"
        reservation.hold_expires_at = now
        db.commit()


# --- the payment arrives -------------------------------------------------------------------------


def on_prepayment_succeeded(db: Session, payment: ReservationPayment, now: datetime | None = None) -> str:
    """
    The renter's online payment has gone through. Confirms the booking and
    issues the advance invoice. Safe to run any number of times, from the
    webhook, the browser's sync call or the sweeper, in any order.

    If the hold ran out first and the car has since been taken, the booking
    cannot be honoured and the payment is refunded in full. Returns what
    happened: "confirmed", "already_confirmed" or "refunded". Never commits.
    """

    now = now or datetime.now(timezone.utc)
    reservation = db.get(Reservation, payment.reservation_id)

    if reservation.status in ("CONFIRMED", "ACTIVE", "COMPLETED"):
        issue_invoice_for_prepayment(db, payment, None)

        return "already_confirmed"

    car_is_ours = False

    if reservation.status in ("AWAITING_PAYMENT", "EXPIRED"):
        # Its own hold no longer blocks once it has run out, so the car can
        # have been booked by someone else in the meantime.
        lock_car(db, reservation.car_id)

        car_is_ours = not has_conflicting_reservation(
            db,
            reservation.car_id,
            reservation.pickup_at,
            reservation.return_at,
            exclude_reservation_id=reservation.id,
        )

    if car_is_ours:
        reservation.status = "CONFIRMED"
        reservation.hold_expires_at = None

        issue_invoice_for_prepayment(db, payment, None)

        audit_log(
            db,
            user=None,
            action="reservation.online_payment_received",
            entity_type="reservation",
            entity_id=reservation.id,
            metadata={"amount": str(payment.payment_amount), "reference": reservation.public_reference},
        )

        queue_booking_confirmed(db, reservation)

        return "confirmed"

    # Cancelled while paying, or the car was taken after the hold ran out.
    refund_prepayment(db, payment)

    reservation.status = "EXPIRED" if reservation.status == "AWAITING_PAYMENT" else reservation.status

    audit_log(
        db,
        user=None,
        action="reservation.online_payment_refunded",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"amount": str(payment.payment_amount), "reason": "car_no_longer_free"},
    )

    return "refunded"


def apply_intent_to_prepayment(db: Session, payment: ReservationPayment, intent_status: str) -> str | None:
    """
    Applies what Stripe says about the intent to the payment, and runs the
    success path when it has just succeeded. Shared by the webhook and the
    sync call. Returns the outcome of on_prepayment_succeeded, or None when the
    payment did not just succeed.
    """

    if not apply_payment_intent_status(payment, intent_status):
        return None

    if payment.payment_status != "SUCCEEDED":
        return None

    return on_prepayment_succeeded(db, payment)


def sync_payment(db: Session, reservation: Reservation) -> Reservation:
    """
    The renter's browser has come back from Stripe: ask Stripe directly instead
    of trusting the browser, so a booking is confirmed even when the webhook is
    late.
    """

    _require_stripe()

    payment = db.scalar(select(ReservationPayment).where(ReservationPayment.reservation_id == reservation.id))

    if payment is not None and payment.stripe_payment_intent_id:
        try:
            intent = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)
        except stripe.StripeError as exc:
            raise stripe_app_error(exc)

        apply_intent_to_prepayment(db, payment, intent.status)
        db.commit()
        db.refresh(reservation)

    return reservation


# --- unpaid holds run out ---------------------------------------------------------------------------


def expire_stale_holds(db: Session, now: datetime | None = None) -> dict:
    """
    Tidies up every hold whose time has passed. If Stripe says the renter did
    pay (the webhook may have been missed), the payment is honoured instead.
    Each booking is handled in its own transaction so one bad one cannot block
    the rest.
    """

    now = now or datetime.now(timezone.utc)
    ids = list(
        db.scalars(
            select(Reservation.id).where(
                Reservation.status == "AWAITING_PAYMENT", Reservation.hold_expires_at <= now
            )
        )
    )
    result = {"expired": 0, "confirmed": 0, "refunded": 0, "failed": 0}

    for reservation_id in ids:
        try:
            outcome = _expire_one(db, reservation_id, now)
            db.commit()
            result[outcome] += 1
        except Exception:  # noqa: BLE001 - one booking must not stop the sweep
            db.rollback()
            result["failed"] += 1
            logger.exception("Could not expire the hold on reservation %s", reservation_id)

    return result


def _expire_one(db: Session, reservation_id, now: datetime) -> str:
    reservation = db.get(Reservation, reservation_id)

    if reservation is None or reservation.status != "AWAITING_PAYMENT":
        return "expired"

    payment = db.scalar(select(ReservationPayment).where(ReservationPayment.reservation_id == reservation_id))

    if payment is not None and payment.stripe_payment_intent_id and stripe.api_key:
        intent = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)

        if intent.status == "succeeded":
            apply_payment_intent_status(payment, intent.status)

            # Idempotent: honours the payment however it was first recorded.
            outcome = on_prepayment_succeeded(db, payment, now)

            return "refunded" if outcome == "refunded" else "confirmed"

        if intent.status != "canceled":
            stripe.PaymentIntent.cancel(intent.id)

        payment.payment_status = "CANCELLED"

    reservation.status = "EXPIRED"

    audit_log(
        db,
        user=None,
        action="reservation.hold_expired",
        entity_type="reservation",
        entity_id=reservation.id,
        metadata={"reference": reservation.public_reference},
    )

    return "expired"


# --- the renter looks at and cancels a booking ---------------------------------------------------------


def find_booking(db: Session, reference: str, email: str) -> Reservation:
    """
    The storefront booking with this reference and this booker's email. Every
    way of not finding one (wrong reference, wrong email, a staff booking)
    gives the same answer, so the lookup cannot be used to discover which
    references exist.
    """

    reservation = db.scalar(
        select(Reservation)
        .join(Customer, Customer.id == Reservation.customer_id)
        .where(
            Reservation.source == "STOREFRONT",
            Reservation.public_reference == normalize_reference(reference),
            func.lower(Customer.email) == email.strip().lower(),
        )
    )

    if reservation is None:
        raise AppError(
            "public.booking_not_found",
            "We could not find a booking with that reference and email.",
            status_code=404,
        )

    return reservation


def _can_cancel(reservation: Reservation, now: datetime) -> bool:
    return reservation.status in ("AWAITING_PAYMENT", "CONFIRMED") and reservation.pickup_at > now


def booking_view(db: Session, reservation: Reservation):
    """The booking as the renter sees it."""

    from app.models import Car
    from app.schemas.public import (
        PublicBooking,
        PublicBookingExtra,
        PublicLocation,
        PublicVehicle,
    )
    from app.services.prepayments import get_prepayment, refund_is_free

    now = datetime.now(timezone.utc)
    car = db.get(Car, reservation.car_id)
    payment = get_prepayment(db, reservation.id)

    paid = Decimal(payment.payment_amount) if payment and payment.payment_status == "SUCCEEDED" else Decimal("0")
    refunded = Decimal(payment.refund_amount or 0) if payment and payment.payment_status == "REFUNDED" else Decimal("0")
    total = Decimal(reservation.agreed_total_amount or 0)

    # What is left to pay when picking up: nothing once the booking is over.
    live = reservation.status in ("AWAITING_PAYMENT", "CONFIRMED", "ACTIVE")
    at_pickup = max(total - paid, Decimal("0")) if live else Decimal("0")

    def location(place):
        return PublicLocation(
            id=place.id,
            name=place.name,
            airport_code=place.airport_code,
            address=place.address,
            timezone=place.timezone,
        )

    return PublicBooking(
        reference=reservation.public_reference,
        status=reservation.status,
        pickup_at=reservation.pickup_at,
        return_at=reservation.return_at,
        pickup_location=location(reservation.pickup_location),
        return_location=location(reservation.return_location),
        vehicle=PublicVehicle(
            make=car.make,
            model=car.model,
            year=car.year,
            category=car.category,
            transmission=car.transmission,
            fuel_type=car.fuel_type,
            seats=car.seats,
            has_photo=car.has_photo,
            photo_version=car.photo_version,
            offer_key=offer_key(car),
            price_per_day=float(reservation.agreed_price_per_day or car.price_per_day),
        ),
        extras=[PublicBookingExtra(name=line.name, quantity=line.quantity) for line in reservation.extras],
        currency=reservation.agreed_currency or "",
        total_amount=float(total),
        paid_online=float(paid),
        refunded_online=float(refunded),
        due_at_pickup=float(at_pickup),
        hold_expires_at=reservation.hold_expires_at,
        cancellation_deadline_at=reservation.cancellation_deadline_at,
        can_cancel=_can_cancel(reservation, now),
        cancel_refunds_online=refund_is_free(reservation, now),
    )


def renter_cancel(db: Session, reservation: Reservation) -> Reservation:
    """
    The renter cancels their own booking. The share they paid online follows
    the admin's policy: refunded in full up to the cancellation deadline, kept
    after it. They cannot choose otherwise.
    """

    from app.services.reservations import cancel_reservation

    if not _can_cancel(reservation, datetime.now(timezone.utc)):
        raise AppError("public.cannot_cancel", "This booking can no longer be cancelled online. Please contact us.")

    _require_stripe_if_paid(db, reservation)

    return cancel_reservation(db, reservation.id, None, reason="RENTER")


def _require_stripe_if_paid(db: Session, reservation: Reservation) -> None:
    from app.services.prepayments import get_prepayment

    payment = get_prepayment(db, reservation.id)

    if payment is not None and payment.payment_status != "CANCELLED":
        _require_stripe()
