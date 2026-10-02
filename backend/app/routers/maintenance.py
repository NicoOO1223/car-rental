from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.dependencies import require_authenticated_user
from app.schemas.maintenance import (
    MaintenanceTaskComplete,
    MaintenanceTaskCreate,
    MaintenanceTaskPage,
    MaintenanceTaskResponse,
)
from app.services.maintenance import (
    cancel_task,
    complete_task,
    create_task,
    list_tasks,
    open_task_counts,
)

router = APIRouter(
    prefix="/api/maintenance",
    tags=["Maintenance"],
    dependencies=[Depends(require_authenticated_user)],
)


@router.get("/tasks", response_model=MaintenanceTaskPage)
def list_tasks_endpoint(
    status: str | None = Query(default=None),
    task_type: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    items, total = list_tasks(
        db, status=status, task_type=task_type, limit=limit, offset=offset
    )

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        **open_task_counts(db),
    }


@router.post("/tasks", response_model=MaintenanceTaskResponse)
def create_task_endpoint(
    data: MaintenanceTaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    task = create_task(
        db,
        data.car_id,
        data.task_type,
        data.category,
        data.notes,
        data.starts_at,
        data.ends_at,
        current_user,
        cost=data.cost,
        cleaning_type=data.cleaning_type,
    )

    return task


@router.patch("/tasks/{task_id}/complete", response_model=MaintenanceTaskResponse)
def complete_task_endpoint(
    task_id: UUID,
    data: MaintenanceTaskComplete | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    task = complete_task(
        db,
        task_id,
        current_user,
        data.next_inspection_due if data else None,
        data.cost if data else None,
    )

    return task


@router.patch("/tasks/{task_id}/cancel", response_model=MaintenanceTaskResponse)
def cancel_task_endpoint(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    task = cancel_task(db, task_id, current_user)

    return task
