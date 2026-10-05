"""
What the public storefront may show and how it prices a rental.

Renters choose an offer, never a car. A vehicle class (see VehicleClass) is one
offer, named "class-<slug>": the business's own name and price, shown with an
example car ("Fiat Panda or similar"). Cars not in a class that look the same to
a renter (same make, model, year, specification, photo and daily price) are one
offer, named by an opaque key. The server picks a real car when the booking is
made, so no plate or other internal detail is ever exposed, and it can swap one
car for another in the offer without the renter noticing.
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
    # Set for a vehicle class: its words per language ({"en": ..}) and address.
    class_slug: str | None
    class_name: dict | None
    class_description: dict | None
    sort_order: int
    # What the cars in the offer have between them: a class may mix.
    seats_min: int | None
    seats_max: int | None
    transmissions: tuple[str, ...]
    fuel_types: tuple[str, ...]
    # The example car: make and model of the one shown ("... or similar").
    make: str
    model: str
    year: int
    category: str | None
    transmission: str | None
    fuel_type: str | None
    seats: int | None
    has_photo: bool
    photo_version: int | None
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
        # Whether a photo exists, not which one — each upload gets its own
        # timestamp, so keying on the exact photo would stop identical cars
        # from ever grouping together once any one of them got a photo.
        car.has_photo,
        str(car.price_per_day),
    ]


def offer_key(car: Car) -> str:
    """A class: "class-<slug>". Otherwise opaque, stable for as long as the cars
    look the same, and not guessable."""

    if car.vehicle_class is not None:
        return f"class-{car.vehicle_class.slug}"

    payload = json.dumps(_identity(car), separators=(",", ":")).encode()

    return hmac.new(SECRET_KEY.encode(), b"offer|" + payload, hashlib.sha256).hexdigest()[:24]


def _example_car(cars: list[Car]) -> Car:
    """The car that stands for the offer: one with a photo if any has, and always the
    same one for the same cars (by plate), so the page does not change on every visit."""

    return sorted(cars, key=lambda car: (not car.has_photo, car.license_plate))[0]


def offer_for(car: Car, members: list[Car] | None = None) -> Offer:
    """The offer a car belongs to. `members` are all the cars in it that are on show,
    for a class made of different cars; without them the car stands alone."""

    cars = members or [car]
    example = _example_car(cars) if car.vehicle_class is not None else car
    seats = [item.seats for item in cars if item.seats is not None]
    cls = car.vehicle_class

    return Offer(
        key=offer_key(car),
        class_slug=cls.slug if cls else None,
        class_name=dict(cls.name) if cls else None,
        class_description=dict(cls.description) if cls else None,
        sort_order=cls.sort_order if cls else 10_000,
        seats_min=min(seats) if seats else None,
        seats_max=max(seats) if seats else None,
        transmissions=tuple(sorted({item.transmission for item in cars if item.transmission})),
        fuel_types=tuple(sorted({item.fuel_type for item in cars if item.fuel_type})),
        make=example.make,
        model=example.model,
        year=example.year,
        category=example.category,
        transmission=example.transmission,
        fuel_type=example.fuel_type,
        seats=example.seats,
        has_photo=example.has_photo,
        photo_version=example.photo_version,
        price_per_day=car.price_per_day,
    )


def public_vehicle_fields(offer: Offer) -> dict:
    """The offer as the fields of PublicVehicle (the one place they are listed)."""

    return {
        "offer_key": offer.key,
        "class_slug": offer.class_slug,
        "class_name": offer.class_name,
        "class_description": offer.class_description,
        "seats_min": offer.seats_min,
        "seats_max": offer.seats_max,
        "transmissions": list(offer.transmissions),
        "fuel_types": list(offer.fuel_types),
        "make": offer.make,
        "model": offer.model,
        "year": offer.year,
        "category": offer.category,
        "transmission": offer.transmission,
        "fuel_type": offer.fuel_type,
        "seats": offer.seats,
        "has_photo": offer.has_photo,
        "photo_version": offer.photo_version,
        "price_per_day": float(offer.price_per_day),
    }


def group_into_offers(cars: list[Car]) -> list[tuple[Offer, list[Car]]]:
    """Cars grouped by offer: classes first in the business's own order, then the
    cars without a class, cheapest first."""

    grouped: dict[str, list[Car]] = {}

    for car in cars:
        grouped.setdefault(offer_key(car), []).append(car)

    offers = [(offer_for(members[0], members), members) for members in grouped.values()]

    return sorted(
        offers,
        key=lambda pair: (
            pair[0].class_slug is None,
            pair[0].sort_order,
            pair[0].price_per_day,
            pair[0].make,
            pair[0].model,
        ),
    )


def offerable(car: Car) -> bool:
    """A car in a class is on show only while its class is: not retired, and offered online."""

    cls = car.vehicle_class

    return cls is None or (cls.retired_at is None and cls.offered_online)


def bookable_cars(db: Session, pickup_location_id, pickup_at: datetime, return_at: datetime) -> list[Car]:
    """The cars the storefront may offer for this period, at this pickup place."""

    return [
        car
        for car in get_available_cars(db, pickup_location_id, pickup_at, return_at, online_only=True)
        if offerable(car)
    ]


def cars_for_offer(db: Session, key: str, pickup_location_id, pickup_at: datetime, return_at: datetime) -> list[Car]:
    """Every free car that is the offer with this key; empty when none is left."""

    return [
        car
        for car in bookable_cars(db, pickup_location_id, pickup_at, return_at)
        if hmac.compare_digest(offer_key(car), key)
    ]


def car_for_offer_key(db: Session, key: str) -> Car | None:
    """
    Any one car whose identity hashes to this offer key — used only to serve
    a representative photo for an offer a renter is browsing (not to check
    availability, so it looks at the whole fleet, not just bookable cars).
    """

    if key.startswith("class-"):
        # A class has a stable address: no need to hash the fleet. Prefer a car with a photo.
        from app.models import VehicleClass

        return db.scalars(
            select(Car)
            .join(VehicleClass, VehicleClass.id == Car.class_id)
            .where(VehicleClass.slug == key.removeprefix("class-"), Car.retired_at.is_(None))
            .order_by(Car.photo_blob_path.is_(None), Car.license_plate)
            .limit(1)
        ).first()

    for car in db.scalars(select(Car).where(Car.class_id.is_(None))).all():
        if hmac.compare_digest(offer_key(car), key):
            return car

    return None


def require_locations(db: Session, pickup_location_id, return_location_id) -> None:
    require_bookable_location(db, pickup_location_id, "pickup")
    require_bookable_location(db, return_location_id, "return")


def offered_cars(db: Session) -> list[Car]:
    """Every car the storefront may show, for the fleet page (no dates)."""

    cars = db.scalars(
        select(Car).where(Car.offered_online.is_(True), Car.retired_at.is_(None)).order_by(Car.make, Car.model, Car.license_plate)
    )

    return [car for car in cars if offerable(car)]


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
