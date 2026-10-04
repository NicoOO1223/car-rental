"""
Vehicles joining and leaving the fleet.

A car is never deleted: reservations, invoices and maintenance history point at
it. Retiring one sets retired_at, which takes it out of every list, search and
report of the current fleet (see Car.retired_at) while keeping its history.
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.errors import AppError, NotFoundError
from app.models import Car, Location, MaintenanceTask, Reservation, User
from app.schemas.car import CarCreate
from app.services.audit import audit_log
from app.services.availability import lock_car

VALID_CATEGORIES = {"ECONOMY", "COMPACT", "MIDSIZE", "PREMIUM", "SUV", "VAN"}
VALID_TRANSMISSIONS = {"MANUAL", "AUTOMATIC"}
VALID_FUEL_TYPES = {"PETROL", "DIESEL", "HYBRID", "ELECTRIC"}


def normalize_plate(plate: str) -> str:
    """Capitals and single spaces, so a plate typed two ways is still one car."""

    return " ".join(plate.upper().split())


def create_car(db: Session, data: CarCreate, actor: User) -> Car:
    """Adds a vehicle to the fleet, at its home location, available."""

    plate = normalize_plate(data.license_plate)

    if db.scalar(select(Car.id).where(Car.license_plate == plate)) is not None:
        raise AppError("car.license_plate_already_use", "License plate already in use.")

    location = db.get(Location, data.home_location_id)

    if location is None:
        raise AppError("location.not_found", "Location not found.")

    if not location.is_active:
        raise AppError("car.home_location_not_in_use", "That location is no longer in use.")

    if data.category is not None and data.category not in VALID_CATEGORIES:
        raise AppError("car.invalid_category_value", "Invalid category.")

    if data.transmission is not None and data.transmission not in VALID_TRANSMISSIONS:
        raise AppError("car.invalid_transmission_value", "Invalid transmission.")

    if data.fuel_type is not None and data.fuel_type not in VALID_FUEL_TYPES:
        raise AppError("car.invalid_fuel_type_value", "Invalid fuel type.")

    car = Car(
        make=data.make.strip(),
        model=data.model.strip(),
        year=data.year,
        license_plate=plate,
        category=data.category,
        transmission=data.transmission,
        fuel_type=data.fuel_type,
        seats=data.seats,
        price_per_day=data.price_per_day,
        current_location_id=location.id,
        home_location_id=location.id,
        mileage=data.mileage,
        offered_online=data.offered_online,
        status="AVAILABLE",
    )

    db.add(car)
    db.flush()

    audit_log(
        db,
        user=actor,
        action="car.created",
        entity_type="car",
        entity_id=car.id,
        metadata={
            "license_plate": car.license_plate,
            "make": car.make,
            "model": car.model,
            "price_per_day": str(car.price_per_day),
            "home_location_id": str(location.id),
        },
    )

    db.commit()
    db.refresh(car)

    return car


def retire_car(db: Session, car_id: UUID, actor: User) -> Car:
    """
    Takes a car out of the fleet for good (sold, written off, returned to the
    lessor). Refused while the car is still needed: out on rental, or holding a
    booking or maintenance window that has not ended, because retiring it would
    strand the renter or the work.
    """

    if db.get(Car, car_id) is None:
        raise NotFoundError("car.not_found", "Car not found.")

    # Serialize with anyone booking this car at the same moment, then read it
    # fresh under the lock.
    lock_car(db, car_id)
    car = db.execute(
        select(Car).where(Car.id == car_id).execution_options(populate_existing=True)
    ).scalar_one()

    if car.is_retired:
        raise AppError("car.already_retired", "This car has already left the fleet.")

    now = datetime.now(timezone.utc)

    open_bookings = db.scalar(
        select(func.count())
        .select_from(Reservation)
        .where(
            Reservation.car_id == car.id,
            Reservation.status.in_(("PENDING", "AWAITING_PAYMENT", "CONFIRMED", "ACTIVE")),
            # An ACTIVE rental that is overdue has a return time in the past but
            # the car is still out, so it counts whatever its date says.
            or_(Reservation.return_at > now, Reservation.status == "ACTIVE"),
        )
    )

    if car.status == "RENTED" or open_bookings:
        raise AppError(
            "car.retire_has_bookings",
            "This car is out on rental or has bookings that have not ended. Cancel or move them first.",
            bookings=int(open_bookings or 0),
        )

    open_work = db.scalar(
        select(func.count())
        .select_from(MaintenanceTask)
        .where(MaintenanceTask.car_id == car.id, MaintenanceTask.status == "OPEN")
    )

    if open_work:
        raise AppError(
            "car.retire_has_maintenance",
            "This car still has open maintenance or cleaning. Complete or cancel it first.",
            tasks=int(open_work),
        )

    car.retired_at = now
    car.offered_online = False

    audit_log(
        db,
        user=actor,
        action="car.retired",
        entity_type="car",
        entity_id=car.id,
        metadata={"license_plate": car.license_plate},
    )

    db.commit()
    db.refresh(car)

    return car


def reactivate_car(db: Session, car_id: UUID, actor: User) -> Car:
    """Puts a retired car back in the fleet (retired by mistake, or bought back).
    It stays off the storefront until staff offer it online again."""

    car = db.get(Car, car_id)

    if car is None:
        raise NotFoundError("car.not_found", "Car not found.")

    if not car.is_retired:
        raise AppError("car.not_retired", "This car is already in the fleet.")

    car.retired_at = None

    audit_log(
        db,
        user=actor,
        action="car.reactivated",
        entity_type="car",
        entity_id=car.id,
        metadata={"license_plate": car.license_plate},
    )

    db.commit()
    db.refresh(car)

    return car
