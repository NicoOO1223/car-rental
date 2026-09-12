from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import Car, MaintenanceTask

VALID_TASK_TYPES = {"MAINTENANCE", "CLEANING"}


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
        raise ValueError("Car not found.")

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
    notes: str | None,
) -> MaintenanceTask:
    car = db.get(Car, car_id)

    if car is None:
        raise ValueError("Car not found.")

    if task_type not in VALID_TASK_TYPES:
        raise ValueError("Invalid task type.")

    existing_open = db.scalar(
        select(MaintenanceTask.id).where(
            MaintenanceTask.car_id == car_id,
            MaintenanceTask.status == "OPEN",
        )
    )

    if existing_open is not None:
        raise ValueError("This car already has an open maintenance task.")

    task = MaintenanceTask(
        car_id=car_id,
        task_type=task_type,
        status="OPEN",
        notes=notes,
    )

    car.status = task_type

    db.add(task)
    db.commit()
    db.refresh(task)

    return task


def _close_task(db: Session, task_id: UUID, new_status: str) -> MaintenanceTask:
    task = db.get(MaintenanceTask, task_id)

    if task is None:
        raise ValueError("Maintenance task not found.")

    if task.status != "OPEN":
        raise ValueError("Only an open task can be closed.")

    task.status = new_status
    task.completed_at = datetime.utcnow()

    car = db.get(Car, task.car_id)
    car.status = "AVAILABLE"

    db.commit()
    db.refresh(task)

    return task


def complete_task(db: Session, task_id: UUID) -> MaintenanceTask:
    return _close_task(db, task_id, "DONE")


def cancel_task(db: Session, task_id: UUID) -> MaintenanceTask:
    return _close_task(db, task_id, "CANCELLED")
