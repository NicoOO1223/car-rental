from decimal import Decimal
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.errors import AppError, NotFoundError
from app.models import Car, MaintenanceTask, User
from app.services.audit import audit_log
from app.services.timezones import assume_zone, business_zone, local_today
from app.services.availability import (
    has_conflicting_maintenance,
    has_conflicting_reservation,
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


def list_tasks(
    db: Session,
    status: str | None = None,
    task_type: str | None = None,
) -> list[MaintenanceTask]:
    query = select(MaintenanceTask).options(joinedload(MaintenanceTask.car))

    if status is not None:
        query = query.where(MaintenanceTask.status == status)

    if task_type is not None:
        query = query.where(MaintenanceTask.task_type == task_type)

    query = query.order_by(MaintenanceTask.opened_at.desc())

    return list(db.scalars(query).all())


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

    # A time typed without a timezone means local time at the business.
    starts_at = assume_zone(starts_at, business_zone(db))
    ends_at = assume_zone(ends_at, business_zone(db))

    if ends_at <= starts_at:
        raise AppError("maintenance.end_time_must_after_start_time", "End time must be after start time.")

    if ends_at <= datetime.now(timezone.utc):
        raise AppError("maintenance.maintenance_window_must_end_future", "The maintenance window must end in the future.")

    if has_conflicting_maintenance(db, car_id, starts_at, ends_at):
        raise AppError("maintenance.car_already_maintenance_or_cleaning_scheduled", "This car already has maintenance or cleaning scheduled during this period.")

    if has_conflicting_reservation(db, car_id, starts_at, ends_at):
        raise AppError("maintenance.car_reservation_during_period_cancel_or", "This car has a reservation during this period. "
            "Cancel or move the reservation first.")

    task = MaintenanceTask(
        car_id=car_id,
        task_type=task_type,
        category=category,
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
