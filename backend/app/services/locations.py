from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Car, Location, Reservation, User
from app.services.audit import audit_log
from app.services.configuration import get_configuration

# Reservations that still need the location to exist and work.
_OPEN_STATUSES = ("PENDING", "CONFIRMED", "ACTIVE")


def list_locations(db: Session, *, include_inactive: bool = False) -> list[Location]:
    query = select(Location).order_by(Location.airport_code)

    if not include_inactive:
        query = query.where(Location.is_active.is_(True))

    return list(db.scalars(query))


def require_bookable_location(db: Session, location_id, label: str) -> Location:
    """A location a new booking may use: it exists and is active."""

    location = db.get(Location, location_id)

    if location is None:
        raise ValueError(f"The {label} location was not found.")

    if not location.is_active:
        raise ValueError(f"The {label} location is no longer in use.")

    return location


def create_location(
    db: Session,
    *,
    actor: User,
    name: str,
    airport_code: str,
    address: str | None,
    timezone: str | None,
) -> Location:
    if db.scalar(select(Location.id).where(Location.airport_code == airport_code)):
        raise ValueError("A location with this code already exists.")

    location = Location(
        name=name,
        airport_code=airport_code,
        address=address,
        # A new location starts in the business's own timezone.
        timezone=timezone or get_configuration(db).timezone,
        is_active=True,
    )
    db.add(location)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ValueError("A location with this code already exists.")

    audit_log(
        db,
        user=actor,
        action="location.created",
        entity_type="location",
        entity_id=location.id,
        metadata={
            "airport_code": location.airport_code,
            "name": location.name,
            "timezone": location.timezone,
        },
    )

    db.commit()
    db.refresh(location)

    return location


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" + ("" if count == 1 else "s")


def _in_use_message(db: Session, location: Location) -> str | None:
    """Why this location cannot be switched off right now, or None."""

    cars_here = db.scalar(
        select(func.count(Car.id)).where(
            or_(
                Car.current_location_id == location.id,
                Car.home_location_id == location.id,
            )
        )
    )
    open_reservations = db.scalar(
        select(func.count(Reservation.id)).where(
            Reservation.status.in_(_OPEN_STATUSES),
            or_(
                Reservation.pickup_location_id == location.id,
                Reservation.return_location_id == location.id,
            ),
        )
    )

    problems = []

    if cars_here:
        problems.append(f"{_plural(cars_here, 'vehicle')} based or parked there")

    if open_reservations:
        problems.append(_plural(open_reservations, "open reservation"))

    if not problems:
        return None

    return (
        "This location is still in use: "
        + " and ".join(problems)
        + ". Move the vehicles and finish or cancel the reservations first."
    )


def update_location(db: Session, *, actor: User, location: Location, **fields) -> Location:
    changes = {}

    for field, value in fields.items():
        if field == "address":
            value = value or None
        elif value is None:
            # None means "leave unchanged" for everything but the address.
            continue

        current = getattr(location, field)

        if value == current:
            continue

        if field == "airport_code":
            taken = db.scalar(
                select(Location.id).where(
                    Location.airport_code == value, Location.id != location.id
                )
            )

            if taken:
                raise ValueError("A location with this code already exists.")

        if field == "is_active" and value is False:
            message = _in_use_message(db, location)

            if message:
                raise ValueError(message)

        changes[field] = {"old": current, "new": value}
        setattr(location, field, value)

    if changes:
        audit_log(
            db,
            user=actor,
            action="location.updated",
            entity_type="location",
            entity_id=location.id,
            metadata=changes,
        )

    db.commit()
    db.refresh(location)

    return location
