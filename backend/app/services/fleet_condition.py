"""
Fleet-wide vehicle condition and insurance, read from the same fields the
per-car "Vehicle condition" card already shows (see app/models/car.py) —
this is a read model over them, not a second place that edits them. Editing
stays on the car's own page; this view exists so an admin can see every
car's state, and the fleet's running costs, without opening each one.
"""

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Car, MaintenanceTask
from app.services.condition_reviews import condition_review_overdue
from app.services.configuration import get_configuration


def oil_change_overdue(car: Car, interval_km: int) -> bool:
    """Whether the car has gone interval_km or more since its last recorded
    oil change. Only answerable once both readings exist — a car with no
    service history yet is excluded rather than flagged."""

    if car.mileage is None or car.last_oil_change_mileage is None:
        return False

    return car.mileage - car.last_oil_change_mileage >= interval_km


def _car_condition(db: Session, car: Car, interval_km: int) -> dict:
    return {
        "id": str(car.id),
        "make": car.make,
        "model": car.model,
        "license_plate": car.license_plate,
        "mileage": car.mileage,
        "tire_condition": car.tire_condition,
        "last_oil_change_at": car.last_oil_change_at.isoformat() if car.last_oil_change_at else None,
        "last_oil_change_mileage": car.last_oil_change_mileage,
        "oil_change_overdue": oil_change_overdue(car, interval_km),
        "condition_review_overdue": condition_review_overdue(db, car),
        "last_inspection_at": car.last_inspection_at.isoformat() if car.last_inspection_at else None,
        "next_inspection_due": car.next_inspection_due.isoformat() if car.next_inspection_due else None,
        "insured_from": car.insured_from.isoformat() if car.insured_from else None,
        "insured_until": car.insured_until.isoformat() if car.insured_until else None,
        "insurance_cost": str(car.insurance_cost) if car.insurance_cost is not None else None,
    }


def get_fleet_condition(db: Session) -> dict:
    configuration = get_configuration(db)
    interval_km = configuration.oil_change_interval_km

    cars = list(db.scalars(select(Car).order_by(Car.license_plate)).all())

    total_insurance_cost = db.scalar(
        select(func.coalesce(func.sum(Car.insurance_cost), 0))
    ) or Decimal("0")

    total_maintenance_spend = db.scalar(
        select(func.coalesce(func.sum(MaintenanceTask.cost), 0)).where(
            MaintenanceTask.status == "DONE"
        )
    ) or Decimal("0")

    cars_by_condition = [_car_condition(db, car, interval_km) for car in cars]

    # Soonest expiry first; a car with no insurance on file sorts last
    # rather than being dropped, so it is still visible as a gap to fill.
    insurance = sorted(
        (c for c in cars_by_condition if c["insured_until"] is not None),
        key=lambda c: c["insured_until"],
    ) + [c for c in cars_by_condition if c["insured_until"] is None]

    return {
        "total_insurance_cost": str(total_insurance_cost),
        "total_maintenance_spend": str(total_maintenance_spend),
        "cars": cars_by_condition,
        "insurance": insurance,
    }
