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

from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import Car
from app.services.configuration import get_configuration
from app.services.timezones import business_zone, local_today

# Most urgent first when severity ties are broken by kind.
KIND_ORDER = (
    "inspection_overdue",
    "insurance_expired",
    "relocation",
    "inspection_due",
    "insurance_ending",
)


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

    items.sort(
        key=lambda item: (
            item["severity"] != "critical",
            KIND_ORDER.index(item["kind"]),
            item.get("days", 0),
            item["car"]["license_plate"],
        )
    )

    return {"reminder_days": days, "items": items}
