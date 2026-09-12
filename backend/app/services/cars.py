from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Car, Location
from app.schemas.car import CarUpdate


VALID_CAR_STATUSES = {
    "AVAILABLE",
    "RESERVED",
    "RENTED",
    "MAINTENANCE",
    "CLEANING",
}

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

    if "current_location_id" in updates:
        location = db.get(Location, updates["current_location_id"])

        if location is None:
            raise ValueError("Location not found.")

    if "status" in updates and updates["status"] not in VALID_CAR_STATUSES:
        raise ValueError("Invalid status value.")

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
