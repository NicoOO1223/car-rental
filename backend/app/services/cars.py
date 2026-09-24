from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import Car, Location, Reservation, User
from app.schemas.car import CarPriceUpdate, CarUpdate
from app.services.audit import audit_log


VALID_TIRE_CONDITIONS = {
    "GOOD",
    "FAIR",
    "WORN",
    "NEEDS_REPLACEMENT",
}


def update_car(
    db: Session,
    car_id: UUID,
    data: CarUpdate,
) -> Car:
    car = db.get(Car, car_id)

    if car is None:
        raise ValueError("Car not found.")

    updates = data.model_dump(exclude_unset=True)

    if "license_plate" in updates:
        conflict = db.scalar(
            select(Car.id).where(
                Car.license_plate == updates["license_plate"],
                Car.id != car_id,
            )
        )

        if conflict is not None:
            raise ValueError("License plate already in use.")

    if "home_location_id" in updates:
        location = db.get(Location, updates["home_location_id"])

        if location is None:
            raise ValueError("Location not found.")

    if (
        "tire_condition" in updates
        and updates["tire_condition"] is not None
        and updates["tire_condition"] not in VALID_TIRE_CONDITIONS
    ):
        raise ValueError("Invalid tire condition value.")

    for field, value in updates.items():
        setattr(car, field, value)

    db.commit()
    db.refresh(car)

    return car


def return_car_to_home(db: Session, car_id: UUID, actor: User) -> Car:
    """
    Records that a car has been moved back to its home airport. Blocked
    while the car is out on rental, or while reservations that pick it up
    at its current (away) airport are still ahead — those were validated
    against where the car is, and would no longer be valid once it moved.
    """

    car = db.scalar(
        select(Car)
        .options(
            joinedload(Car.current_location),
            joinedload(Car.home_location),
        )
        .where(Car.id == car_id)
    )

    if car is None:
        raise ValueError("Car not found.")

    if not car.is_away_from_home:
        raise ValueError("This car is already at its home airport.")

    now = datetime.now(timezone.utc)

    blocking = db.scalars(
        select(Reservation)
        .where(
            Reservation.car_id == car_id,
            Reservation.status.in_(("ACTIVE", "CONFIRMED", "PENDING")),
            Reservation.return_at > now,
            (Reservation.status == "ACTIVE")
            | (Reservation.pickup_location_id == car.current_location_id),
        )
        .order_by(Reservation.pickup_at)
    ).all()

    if blocking:
        references = ", ".join(str(r.id)[:8].upper() for r in blocking[:5])

        raise ValueError(
            "This car can't be moved yet: it has an active rental or "
            f"reservations that pick it up at {car.current_location.airport_code} "
            f"({references}). Cancel or complete them first."
        )

    from_code = car.current_location.airport_code

    car.current_location_id = car.home_location_id

    audit_log(
        db,
        user=actor,
        action="car.relocated",
        entity_type="car",
        entity_id=car.id,
        metadata={
            "from": from_code,
            "to": car.home_location.airport_code,
        },
    )

    db.commit()
    db.refresh(car)

    return car


def update_car_price(
    db: Session,
    car_id: UUID,
    data: CarPriceUpdate,
    actor: User,
) -> Car:
    """
    Sets a vehicle's daily rate, admin-only and audited. The rate is read
    live wherever a price is worked out (quotes, handover payment,
    agreements), so a change also reprices reservations that haven't been
    paid yet; paid amounts are stored on the handover.
    """

    car = db.scalar(
        select(Car)
        .options(joinedload(Car.current_location), joinedload(Car.home_location))
        .where(Car.id == car_id)
    )

    if car is None:
        raise ValueError("Car not found.")

    if data.price_per_day != car.price_per_day:
        audit_log(
            db,
            user=actor,
            action="car.price_updated",
            entity_type="car",
            entity_id=car.id,
            metadata={
                "license_plate": car.license_plate,
                "old": str(car.price_per_day),
                "new": str(data.price_per_day),
            },
        )

        car.price_per_day = data.price_per_day

    db.commit()
    db.refresh(car)

    return car
