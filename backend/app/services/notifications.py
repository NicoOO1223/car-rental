"""
Things staff should act on, worked out from the data each time they are
asked for rather than stored: a car that needs to be moved back to its home
airport, a technical inspection that is due soon or overdue, and an
insurance period that is about to end or has ended.

Nothing is stored, so there is nothing to mark as read or to fall out of
date: a notification disappears the moment the thing it is about is fixed
(the car is returned, the next inspection or insurance period is recorded).
The interface words each one from its kind and values, in the reader's
language.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import Car, Customer, Reservation
from app.services.condition_reviews import condition_review_overdue
from app.services.configuration import get_configuration
from app.services.fleet_condition import oil_change_overdue
from app.services.timezones import business_zone, local_today

# Most urgent first when severity ties are broken by kind.
KIND_ORDER = (
    "inspection_overdue",
    "insurance_expired",
    "relocation",
    "inspection_due",
    "insurance_ending",
    "oil_change_due",
    "condition_review_due",
    "online_booking",
)

# How long a booking made on the website is announced as new.
NEW_ONLINE_BOOKING_DAYS = 3


def _car(car: Car) -> dict:
    return {
        "id": str(car.id),
        "make": car.make,
        "model": car.model,
        "license_plate": car.license_plate,
    }


def list_notifications(db: Session) -> dict:
    configuration = get_configuration(db)
    days = configuration.reminder_days
    today = local_today(business_zone(db))
    horizon = today + timedelta(days=days)

    cars = db.scalars(
        select(Car)
        .options(joinedload(Car.current_location), joinedload(Car.home_location))
        .where(
            Car.retired_at.is_(None),
            or_(
                Car.current_location_id != Car.home_location_id,
                Car.next_inspection_due <= horizon,
                Car.insured_until <= horizon,
            )
        )
        .order_by(Car.license_plate)
    ).all()

    items: list[dict] = []

    for car in cars:
        base = {"car": _car(car)}

        if car.is_away_from_home:
            items.append(
                {
                    **base,
                    "kind": "relocation",
                    "severity": "warning",
                    "airport": car.current_location.airport_code,
                    "home_airport": car.home_location.airport_code,
                }
            )

        if car.next_inspection_due is not None and car.next_inspection_due <= horizon:
            overdue = car.next_inspection_due < today
            items.append(
                {
                    **base,
                    "kind": "inspection_overdue" if overdue else "inspection_due",
                    "severity": "critical" if overdue else "warning",
                    "date": car.next_inspection_due.isoformat(),
                    "days": (car.next_inspection_due - today).days,
                }
            )

        if car.insured_until is not None and car.insured_until <= horizon:
            expired = car.insured_until < today
            items.append(
                {
                    **base,
                    "kind": "insurance_expired" if expired else "insurance_ending",
                    "severity": "critical" if expired else "warning",
                    "date": car.insured_until.isoformat(),
                    "days": (car.insured_until - today).days,
                }
            )

    # Neither of these fits the date horizon query above (one is
    # distance-based, the other is rental-count-based), so they run as
    # their own pass over every car instead.
    interval_km = configuration.oil_change_interval_km

    for car in db.scalars(select(Car).where(Car.retired_at.is_(None)).order_by(Car.license_plate)).all():
        if oil_change_overdue(car, interval_km):
            items.append(
                {
                    "car": _car(car),
                    "kind": "oil_change_due",
                    "severity": "warning",
                    "km_since": car.mileage - car.last_oil_change_mileage,
                }
            )

        if condition_review_overdue(db, car):
            items.append(
                {
                    "car": _car(car),
                    "kind": "condition_review_due",
                    "severity": "warning",
                }
            )

    now = datetime.now(timezone.utc)

    # Bookings renters made and paid for on the website, to look at and
    # prepare. They go away once they are old, started or cancelled.
    online = db.execute(
        select(Reservation, Car, Customer)
        .join(Car, Car.id == Reservation.car_id)
        .join(Customer, Customer.id == Reservation.customer_id)
        .where(
            Reservation.source == "STOREFRONT",
            Reservation.status == "CONFIRMED",
            Reservation.pickup_at >= now,
            Reservation.created_at >= now - timedelta(days=NEW_ONLINE_BOOKING_DAYS),
        )
        .order_by(Reservation.pickup_at)
    ).all()

    for reservation, car, customer in online:
        items.append(
            {
                "car": _car(car),
                "kind": "online_booking",
                "severity": "info",
                "reservation_id": str(reservation.id),
                "reference": reservation.public_reference,
                "customer": f"{customer.first_name} {customer.last_name}",
                "date": reservation.pickup_at.isoformat(),
                "days": (reservation.pickup_at - now).days,
            }
        )

    items.sort(
        key=lambda item: (
            item["severity"] != "critical",
            KIND_ORDER.index(item["kind"]),
            item.get("days", 0),
            item["car"]["license_plate"],
        )
    )

    return {"reminder_days": days, "items": items}
