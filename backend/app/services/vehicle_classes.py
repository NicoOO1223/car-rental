"""
Vehicle classes: groups of cars rented out alike at one price.

The price of a class is written to every car in it (Car.price_per_day), so quotes,
agreed prices, invoices and reports, which all read the car's price, need no
knowledge of classes. These functions are the only place that writes it for a
classed car, so the two cannot drift apart.
"""

import re
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError, NotFoundError
from app.languages import DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES
from app.models import Car, User, VehicleClass
from app.schemas.vehicle_class import VehicleClassCreate, VehicleClassUpdate
from app.services.audit import audit_log
from app.services.availability import lock_car

NAME_MAX = 80
DESCRIPTION_MAX = 500


def clean_text(value: dict[str, str] | None, *, maximum: int, required: bool, code: str) -> dict[str, str]:
    """Keeps the supported languages, trimmed, without empty entries. A name must
    at least have English, which the other languages fall back to."""

    cleaned: dict[str, str] = {}

    for language, text in (value or {}).items():
        if language not in SUPPORTED_LANGUAGES:
            raise AppError("class.unknown_language", "That language is not supported.", language=language)

        text = " ".join((text or "").split()) if maximum <= NAME_MAX else (text or "").strip()

        if len(text) > maximum:
            raise AppError("class.text_too_long", f"At most {maximum} characters.", limit=maximum)

        if text:
            cleaned[language] = text

    if required and DEFAULT_LANGUAGE not in cleaned:
        raise AppError(code, "Give the class a name in English.")

    return cleaned


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "class"


def _unique_slug(db: Session, text: str) -> str:
    base = _slugify(text)
    slug, number = base, 2

    while db.scalar(select(VehicleClass.id).where(VehicleClass.slug == slug)) is not None:
        slug, number = f"{base}-{number}", number + 1

    return slug


def get_class(db: Session, class_id: UUID) -> VehicleClass:
    row = db.get(VehicleClass, class_id)

    if row is None:
        raise NotFoundError("class.not_found", "That class does not exist.")

    return row


def list_classes(db: Session, include_retired: bool = False) -> list[dict]:
    """Classes in display order, each with how many cars it has."""

    query = select(VehicleClass).order_by(VehicleClass.sort_order, VehicleClass.created_at)

    if not include_retired:
        query = query.where(VehicleClass.retired_at.is_(None))

    counts = {
        class_id: (cars, online)
        for class_id, cars, online in db.execute(
            select(
                Car.class_id,
                func.count(),
                func.count().filter(Car.offered_online.is_(True)),
            )
            .where(Car.class_id.is_not(None), Car.retired_at.is_(None))
            .group_by(Car.class_id)
        )
    }

    rows = []

    for row in db.scalars(query):
        cars, online = counts.get(row.id, (0, 0))
        rows.append({**{c.name: getattr(row, c.name) for c in VehicleClass.__table__.columns}, "is_retired": row.is_retired, "car_count": cars, "online_car_count": online})

    return rows


def create_class(db: Session, data: VehicleClassCreate, actor: User) -> VehicleClass:
    name = clean_text(data.name, maximum=NAME_MAX, required=True, code="class.name_required")
    description = clean_text(data.description, maximum=DESCRIPTION_MAX, required=False, code="")

    row = VehicleClass(
        slug=_unique_slug(db, name[DEFAULT_LANGUAGE]),
        name=name,
        description=description,
        price_per_day=data.price_per_day,
        sort_order=data.sort_order,
        offered_online=data.offered_online,
    )
    db.add(row)
    db.flush()

    audit_log(
        db,
        user=actor,
        action="vehicle_class.created",
        entity_type="vehicle_class",
        entity_id=row.id,
        metadata={"name": name[DEFAULT_LANGUAGE], "price_per_day": str(row.price_per_day)},
    )

    db.commit()
    db.refresh(row)

    return row


def _write_price_to_cars(db: Session, row: VehicleClass) -> int:
    """Every car in the class (retired ones too, so history and a later
    reactivation agree) gets the class price. Returns how many changed."""

    members = list(db.scalars(select(Car).where(Car.class_id == row.id)))

    # In id order, like every other multi-car lock, so two edits cannot wait on each other.
    for car in sorted(members, key=lambda item: str(item.id)):
        lock_car(db, car.id)

    changed = 0

    for car in members:
        if car.price_per_day != row.price_per_day:
            car.price_per_day = row.price_per_day
            changed += 1

    return changed


def update_class(db: Session, class_id: UUID, data: VehicleClassUpdate, actor: User) -> VehicleClass:
    row = get_class(db, class_id)
    updates = data.model_dump(exclude_unset=True)
    changes: dict[str, object] = {}

    if "name" in updates:
        value = clean_text(updates["name"], maximum=NAME_MAX, required=True, code="class.name_required")

        if value != row.name:
            row.name = value
            changes["name"] = value[DEFAULT_LANGUAGE]

    if "description" in updates:
        value = clean_text(updates["description"], maximum=DESCRIPTION_MAX, required=False, code="")

        if value != row.description:
            row.description = value
            changes["description"] = True

    for field in ("sort_order", "offered_online"):
        if updates.get(field) is not None and updates[field] != getattr(row, field):
            setattr(row, field, updates[field])
            changes[field] = updates[field]

    cars_repriced = 0

    if updates.get("price_per_day") is not None and Decimal(updates["price_per_day"]) != row.price_per_day:
        changes["price_per_day"] = {"old": str(row.price_per_day), "new": str(updates["price_per_day"])}
        row.price_per_day = updates["price_per_day"]
        cars_repriced = _write_price_to_cars(db, row)

    if changes:
        audit_log(
            db,
            user=actor,
            action="vehicle_class.updated",
            entity_type="vehicle_class",
            entity_id=row.id,
            metadata={**changes, "cars_repriced": cars_repriced},
        )

    db.commit()
    db.refresh(row)

    return row


def retire_class(db: Session, class_id: UUID, actor: User) -> VehicleClass:
    from datetime import datetime, timezone

    row = get_class(db, class_id)

    if row.is_retired:
        raise AppError("class.already_retired", "This class is already retired.")

    in_use = db.scalar(select(func.count()).select_from(Car).where(Car.class_id == row.id, Car.retired_at.is_(None)))

    if in_use:
        raise AppError(
            "class.has_cars",
            "This class still has cars. Move them to another class first.",
            cars=int(in_use),
        )

    row.retired_at = datetime.now(timezone.utc)
    audit_log(db, user=actor, action="vehicle_class.retired", entity_type="vehicle_class", entity_id=row.id, metadata={})
    db.commit()
    db.refresh(row)

    return row


def reactivate_class(db: Session, class_id: UUID, actor: User) -> VehicleClass:
    row = get_class(db, class_id)

    if not row.is_retired:
        raise AppError("class.not_retired", "This class is not retired.")

    row.retired_at = None
    audit_log(db, user=actor, action="vehicle_class.reactivated", entity_type="vehicle_class", entity_id=row.id, metadata={})
    db.commit()
    db.refresh(row)

    return row


def set_car_class(db: Session, car_id: UUID, class_id: UUID | None, actor: User) -> Car:
    """Puts a car in a class (it takes the class price) or out of it (it keeps the
    price it had). Cars already booked keep the price they were booked at."""

    car = db.get(Car, car_id)

    if car is None:
        raise NotFoundError("car.not_found", "Car not found.")

    target = None

    if class_id is not None:
        target = get_class(db, class_id)

        if target.is_retired:
            raise AppError("class.retired", "That class has been retired.")

    if car.class_id == class_id:
        return car

    lock_car(db, car.id)
    previous = car.class_id
    car.class_id = class_id

    if target is not None:
        car.price_per_day = target.price_per_day

    audit_log(
        db,
        user=actor,
        action="car.class_changed",
        entity_type="car",
        entity_id=car.id,
        metadata={
            "license_plate": car.license_plate,
            "from": str(previous) if previous else None,
            "to": str(class_id) if class_id else None,
        },
    )

    db.commit()
    db.refresh(car)

    return car
