from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.maintenance import MaintenanceTaskCreate, MaintenanceTaskResponse
from app.services.maintenance import (
    cancel_task,
    complete_task,
    create_task,
    list_tasks,
)

router = APIRouter(
    prefix="/api/maintenance",
    tags=["Maintenance"],
)


def _raise_for_value_error(exc: ValueError):
    if str(exc) in ("Car not found.", "Maintenance task not found."):
        raise HTTPException(status_code=404, detail=str(exc))

    raise HTTPException(status_code=400, detail=str(exc))


@router.get("/tasks", response_model=list[MaintenanceTaskResponse])
def list_tasks_endpoint(
    status: str | None = Query(default=None),
    task_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return list_tasks(db, status=status, task_type=task_type)


@router.post("/tasks", response_model=MaintenanceTaskResponse)
def create_task_endpoint(
    data: MaintenanceTaskCreate,
    db: Session = Depends(get_db),
):
    try:
        task = create_task(db, data.car_id, data.task_type, data.notes)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return task


@router.patch("/tasks/{task_id}/complete", response_model=MaintenanceTaskResponse)
def complete_task_endpoint(
    task_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        task = complete_task(db, task_id)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return task


@router.patch("/tasks/{task_id}/cancel", response_model=MaintenanceTaskResponse)
def cancel_task_endpoint(
    task_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        task = cancel_task(db, task_id)
    except ValueError as exc:
        _raise_for_value_error(exc)

    return task
