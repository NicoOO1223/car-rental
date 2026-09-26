"""
What the public storefront may show and how it prices a rental.

Renters choose an offer, never a car. Cars that look the same to a renter (same
make, model, year, specification, photo and daily price) are one offer, named by
an opaque key. The server picks a real car when the booking is made, so no plate
or other internal detail is ever exposed, and it can swap one identical car for
another without the renter noticing.
"""

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import SECRET_KEY
from app.errors import AppError, NotFoundError
from app.models import Car, Configuration
from app.services.availability import get_available_cars
from app.services.locations import require_bookable_location
from app.services.money import round_money

# Stripe will not take a charge below this (in the main unit of the currency).
MIN_ONLINE_CHARGE = Decimal("0.50")

# Bounds on what a renter may ask for, so a search cannot be made expensive.
MAX_RENTAL_DAYS = 60
MAX_DAYS_AHEAD = 365


def require_storefront_enabled(configuration: Configuration) -> None:
    if not configuration.storefront_enabled:
        raise NotFoundError("public.storefront_disabled", "Online booking is not available.")


def validate_window(
    configuration: Configuration, pickup_at: datetime, return_at: datetime, *, now: datetime | None = None
) -> None:
    """The rental period is sensible and far enough ahead to prepare the car."""

    now = now or datetime.now(timezone.utc)

    if pickup_at.tzinfo is None or return_at.tzinfo is None:
        raise AppError("public.datetime_needs_zone", "Dates and times must include a time zone.")

    if return_at <= pickup_at:
        raise AppError("reservation.return_before_pickup", "Return time must be after pickup time.")

    lead = timedelta(hours=configuration.min_booking_lead_hours)

    if pickup_at < now + lead:
        raise AppError(
            "public.pickup_too_soon",
            "Pickup must be at least {hours} hours from now.",
            hours=configuration.min_booking_lead_hours,
        )

    if pickup_at > now + timedelta(days=MAX_DAYS_AHEAD):
        raise AppError("public.pickup_too_far_ahead", "Pickup is too far ahead to book online.")

    if return_at - pickup_at > timedelta(days=MAX_RENTAL_DAYS):
        raise AppError(
            "public.rental_too_long",
            "Online rentals are limited to {days} days.",
            days=MAX_RENTAL_DAYS,
        )


# --- Offers ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Offer:
    key: str
    make: str
    model: str
    year: int
    category: str | None
    transmission: str | None
    fuel_type: str | None
    seats: int | None
    image_url: str | None
    price_per_day: Decimal


def _identity(car: Car) -> list:
    return [
        car.make,
        car.model,
        car.year,
        car.category,
        car.transmission,
        car.fuel_type,
        car.seats,
        car.image_url,
        str(car.price_per_day),
    ]


def offer_key(car: Car) -> str:
    """Opaque, stable for as long as the cars look the same, and not guessable."""

    payload = json.dumps(_identity(car), separators=(",", ":")).encode()

    return hmac.new(SECRET_KEY.encode(), b"offer|" + payload, hashlib.sha256).hexdigest()[:24]


def offer_for(car: Car) -> Offer:
    return Offer(
        key=offer_key(car),
        make=car.make,
        model=car.model,
        year=car.year,
        category=car.category,
        transmission=car.transmission,
        fuel_type=car.fuel_type,
        seats=car.seats,
        image_url=car.image_url,
        price_per_day=car.price_per_day,
    )


def group_into_offers(cars: list[Car]) -> list[tuple[Offer, list[Car]]]:
    """Cars grouped by offer, cheapest first, then by name."""

    groups: dict[str, tuple[Offer, list[Car]]] = {}

    for car in cars:
        offer = offer_for(car)
        groups.setdefault(offer.key, (offer, []))[1].append(car)

    return sorted(groups.values(), key=lambda pair: (pair[0].price_per_day, pair[0].make, pair[0].model))


def bookable_cars(db: Session, pickup_location_id, pickup_at: datetime, return_at: datetime) -> list[Car]:
    """The cars the storefront may offer for this period, at this pickup place."""

    return get_available_cars(db, pickup_location_id, pickup_at, return_at, online_only=True)


def cars_for_offer(db: Session, key: str, pickup_location_id, pickup_at: datetime, return_at: datetime) -> list[Car]:
    """Every free car that is the offer with this key; empty when none is left."""

    return [
        car
        for car in bookable_cars(db, pickup_location_id, pickup_at, return_at)
        if hmac.compare_digest(offer_key(car), key)
    ]


def require_locations(db: Session, pickup_location_id, return_location_id) -> None:
    require_bookable_location(db, pickup_location_id, "pickup")
    require_bookable_location(db, return_location_id, "return")


def offered_cars(db: Session) -> list[Car]:
    """Every car the storefront may show, for the fleet page (no dates)."""

    return list(
        db.scalars(select(Car).where(Car.offered_online.is_(True)).order_by(Car.make, Car.model, Car.license_plate))
    )


# --- The online share -------------------------------------------------------------------------


def split_payment(total: Decimal, percent: int) -> tuple[Decimal, Decimal]:
    """
    (paid online now, paid at pickup). The share is the admin's percentage of
    the total, rounded to cents, never below the smallest charge Stripe accepts
    and never more than the total. At 100 percent nothing is left for pickup.
    """

    total = round_money(Decimal(total))

    if total <= 0:
        raise AppError("public.nothing_to_pay", "There is nothing to pay for this rental.")

    online = round_money(total * Decimal(percent) / Decimal(100))
    online = min(max(online, MIN_ONLINE_CHARGE), total)

    return online, total - online


def cancellation_deadline(configuration: Configuration, pickup_at: datetime) -> datetime:
    """The last moment the renter can cancel and get the online share back."""

    return pickup_at - timedelta(hours=configuration.free_cancellation_hours)
