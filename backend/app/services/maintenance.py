from decimal import Decimal
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.errors import AppError, NotFoundError
from app.models import Car, MaintenanceTask, User
from app.services.audit import audit_log
from app.services.timezones import assume_zone, business_zone, local_today
from app.services.availability import (
    has_conflicting_maintenance,
    has_conflicting_reservation,
    lock_car,
)

VALID_TASK_TYPES = {"MAINTENANCE", "CLEANING"}

# Subcategories of MAINTENANCE — e.g. repairing damage is a different job
# from a technical inspection coming due.
VALID_CATEGORIES = {
    "DAMAGE_REPAIR",
    "TECHNICAL_INSPECTION",
    "ROUTINE_SERVICE",
    "OTHER",
}

# Subtypes of CLEANING. Optional, unlike a MAINTENANCE category: a cleaning
# task logged without picking one just doesn't say which kind it is.
VALID_CLEANING_TYPES = {"INTERIOR", "EXTERIOR", "FULL"}


def list_tasks(
    db: Session,
    status: str | None = None,
    task_type: str | None = None,
    sort: str = "opened_desc",
    limit: int = 25,
    offset: int = 0,
) -> tuple[list[MaintenanceTask], int]:
    """One page of tasks (newest first unless asked otherwise) and how many
    match in all. The history only ever grows, so it is paged on the server."""

    # When a task takes the car out of service: its start, or when it was opened.
    window = func.coalesce(MaintenanceTask.starts_at, MaintenanceTask.opened_at)
    newest = (MaintenanceTask.opened_at.desc(), MaintenanceTask.id)

    orderings = {
        "opened_desc": newest,
        "opened_asc": (MaintenanceTask.opened_at.asc(), MaintenanceTask.id),
        "vehicle_asc": (Car.make.asc(), Car.model.asc(), Car.license_plate.asc(), *newest),
        "vehicle_desc": (Car.make.desc(), Car.model.desc(), Car.license_plate.desc(), *newest),
        "type_asc": (MaintenanceTask.task_type.asc(), *newest),
        "type_desc": (MaintenanceTask.task_type.desc(), *newest),
        "window_asc": (window.asc(), MaintenanceTask.id),
        "window_desc": (window.desc(), MaintenanceTask.id),
        # A task with no cost recorded sorts last either way.
        "cost_asc": (MaintenanceTask.cost.asc().nulls_last(), *newest),
        "cost_desc": (MaintenanceTask.cost.desc().nulls_last(), *newest),
        "status_asc": (MaintenanceTask.status.asc(), *newest),
        "status_desc": (MaintenanceTask.status.desc(), *newest),
    }

    conditions = []

    if status is not None:
        conditions.append(MaintenanceTask.status == status)

    if task_type is not None:
        conditions.append(MaintenanceTask.task_type == task_type)

    total = db.scalar(select(func.count()).select_from(MaintenanceTask).where(*conditions)) or 0

    rows = db.scalars(
        select(MaintenanceTask)
        .join(Car, Car.id == MaintenanceTask.car_id)
        .options(joinedload(MaintenanceTask.car))
        .where(*conditions)
        .order_by(*orderings.get(sort, newest))
        .limit(limit)
        .offset(offset)
    ).all()

    return list(rows), total


def open_task_counts(db: Session) -> dict[str, int]:
    """How many maintenance and cleaning tasks are open right now, whatever
    page or filter is showing."""

    counts = dict(
        db.execute(
            select(MaintenanceTask.task_type, func.count())
            .where(MaintenanceTask.status == "OPEN")
            .group_by(MaintenanceTask.task_type)
        ).all()
    )

    return {
        "open_maintenance": counts.get("MAINTENANCE", 0),
        "open_cleaning": counts.get("CLEANING", 0),
    }


def list_open_tasks(db: Session) -> list[MaintenanceTask]:
    """Every car's currently open maintenance/cleaning task in one request —
    the counterpart of the fleet reservations endpoint, for the fleet-wide
    schedule timeline."""

    return list(
        db.scalars(
            select(MaintenanceTask)
            .where(MaintenanceTask.status == "OPEN")
            .order_by(MaintenanceTask.starts_at.asc())
        ).all()
    )


def list_tasks_for_car(db: Session, car_id: UUID) -> list[MaintenanceTask]:
    car = db.get(Car, car_id)

    if car is None:
        raise NotFoundError("car.not_found", "Car not found.")

    return list(
        db.scalars(
            select(MaintenanceTask)
            .options(joinedload(MaintenanceTask.car))
            .where(MaintenanceTask.car_id == car_id)
            .order_by(MaintenanceTask.opened_at.desc())
        ).all()
    )


def create_task(
    db: Session,
    car_id: UUID,
    task_type: str,
    category: str | None,
    notes: str | None,
    starts_at: datetime,
    ends_at: datetime,
    actor: User,
    commit: bool = True,
    cost: Decimal | None = None,
    cleaning_type: str | None = None,
) -> MaintenanceTask:
    """
    With commit=False the task and its audit row are only flushed, so the
    caller can make them part of a larger transaction (check-out does).
    """

    car = db.get(Car, car_id)

    if car is None:
        raise NotFoundError("car.not_found", "Car not found.")

    if task_type not in VALID_TASK_TYPES:
        raise AppError("maintenance.invalid_task_type", "Invalid task type.")

    if task_type == "MAINTENANCE":
        if category not in VALID_CATEGORIES:
            raise AppError("maintenance.select_maintenance_category", "Select a maintenance category.")
    elif category is not None:
        raise AppError("maintenance.only_maintenance_tasks_have_category", "Only maintenance tasks have a category.")

    if task_type == "CLEANING":
        if cleaning_type is not None and cleaning_type not in VALID_CLEANING_TYPES:
            raise AppError("maintenance.invalid_cleaning_type", "Invalid cleaning type.")
    elif cleaning_type is not None:
        raise AppError("maintenance.only_cleaning_tasks_have_cleaning_type", "Only cleaning tasks have a cleaning type.")

    # A time typed without a timezone means local time at the business.
    starts_at = assume_zone(starts_at, business_zone(db))
    ends_at = assume_zone(ends_at, business_zone(db))

    if ends_at <= starts_at:
        raise AppError("maintenance.end_time_must_after_start_time", "End time must be after start time.")

    if ends_at <= datetime.now(timezone.utc):
        raise AppError("maintenance.maintenance_window_must_end_future", "The maintenance window must end in the future.")

    # The same lock a booking takes, so a booking and a task for this car made
    # at the same moment are checked one after the other. Without it each
    # would pass its check before the other was visible, and both would stand.
    lock_car(db, car_id)

    if has_conflicting_maintenance(db, car_id, starts_at, ends_at):
        raise AppError("maintenance.car_already_maintenance_or_cleaning_scheduled", "This car already has maintenance or cleaning scheduled during this period.")

    # Bookings that only hold this car for a class can go to another car of the class.
    if has_conflicting_reservation(db, car_id, starts_at, ends_at):
        from app.services.class_assignment import move_provisional_off

        move_provisional_off(db, car, starts_at, ends_at)

    if has_conflicting_reservation(db, car_id, starts_at, ends_at):
        raise AppError("maintenance.car_reservation_during_period_cancel_or", "This car has a reservation during this period. "
            "Cancel or move the reservation first.")

    task = MaintenanceTask(
        car_id=car_id,
        task_type=task_type,
        category=category,
        cleaning_type=cleaning_type,
        status="OPEN",
        notes=notes,
        cost=cost,
        starts_at=starts_at,
        ends_at=ends_at,
    )

    db.add(task)
    db.flush()

    audit_log(
        db,
        user=actor,
        action="maintenance_task.created",
        entity_type="maintenance_task",
        entity_id=task.id,
        metadata={
            "car_id": str(car.id),
            "license_plate": car.license_plate,
            "task_type": task_type,
            "category": category,
            "cleaning_type": cleaning_type,
            "notes": notes,
            "cost": str(cost) if cost is not None else None,
            "starts_at": starts_at.isoformat(),
            "ends_at": ends_at.isoformat(),
        },
    )

    if commit:
        db.commit()
        db.refresh(task)
    else:
        db.flush()

    return task


def _close_task(
    db: Session,
    task_id: UUID,
    new_status: str,
    actor: User,
    next_inspection_due: date | None = None,
    cost: Decimal | None = None,
) -> MaintenanceTask:
    task = db.get(MaintenanceTask, task_id)

    if task is None:
        raise NotFoundError("maintenance.task_not_found", "Maintenance task not found.")

    if task.status != "OPEN":
        raise AppError("maintenance.only_open_task_can_closed", "Only an open task can be closed.")

    is_inspection_done = (
        new_status == "DONE" and task.category == "TECHNICAL_INSPECTION"
    )
    is_routine_done = (
        new_status == "DONE" and task.category == "ROUTINE_SERVICE"
    )

    if is_inspection_done:
        if next_inspection_due is None:
            raise AppError("maintenance.enter_when_next_technical_inspection_due", "Enter when the next technical inspection is due.")

        if next_inspection_due <= local_today(business_zone(db)):
            raise AppError("maintenance.next_inspection_must_due_after_today", "The next inspection must be due after today.")

    task.status = new_status
    task.completed_at = datetime.now(timezone.utc)

    # A completed task's final cost replaces the estimate; leaving it out
    # keeps whatever was entered before.
    if new_status == "DONE" and cost is not None:
        task.cost = cost

    car = db.get(Car, task.car_id)

    # The inspection just happened: record it on the car, and when the
    # next one is due (asked for at the moment of closing).
    if is_inspection_done:
        car.last_inspection_at = local_today(business_zone(db))
        car.next_inspection_due = next_inspection_due

    # Likewise for a routine service: record when it happened and the
    # odometer reading at the time, so a fleet-wide view can flag the next
    # one overdue by distance as well as by date.
    if is_routine_done:
        car.last_oil_change_at = local_today(business_zone(db))
        car.last_oil_change_mileage = car.mileage

    # Availability comes from the window, so closing early frees the car on
    # its own. This only clears a status that was set directly (older
    # tasks drove Car.status), and only if no other window is running now.
    now = datetime.now(timezone.utc)

    if car.status in ("MAINTENANCE", "CLEANING") and not has_conflicting_maintenance(
        db, car.id, now, now + timedelta(seconds=1)
    ):
        car.status = "AVAILABLE"

    audit_log(
        db,
        user=actor,
        action=(
            "maintenance_task.completed"
            if new_status == "DONE"
            else "maintenance_task.cancelled"
        ),
        entity_type="maintenance_task",
        entity_id=task.id,
        metadata={
            "car_id": str(car.id),
            "license_plate": car.license_plate,
            "task_type": task.task_type,
            "category": task.category,
            "notes": task.notes,
            "cost": str(task.cost) if task.cost is not None else None,
            "starts_at": task.starts_at.isoformat() if task.starts_at else None,
            "ends_at": task.ends_at.isoformat() if task.ends_at else None,
            **(
                {
                    "last_inspection_at": car.last_inspection_at.isoformat(),
                    "next_inspection_due": car.next_inspection_due.isoformat(),
                }
                if is_inspection_done
                else {}
            ),
            **(
                {
                    "last_oil_change_at": car.last_oil_change_at.isoformat(),
                    "last_oil_change_mileage": car.last_oil_change_mileage,
                }
                if is_routine_done
                else {}
            ),
        },
    )

    db.commit()
    db.refresh(task)

    return task


def complete_task(
    db: Session,
    task_id: UUID,
    actor: User,
    next_inspection_due: date | None = None,
    cost: Decimal | None = None,
) -> MaintenanceTask:
    return _close_task(db, task_id, "DONE", actor, next_inspection_due, cost)


def cancel_task(db: Session, task_id: UUID, actor: User) -> MaintenanceTask:
    return _close_task(db, task_id, "CANCELLED", actor)
