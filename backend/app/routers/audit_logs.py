from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_role
from app.schemas.audit_log import AuditLogActor, AuditLogListItem, AuditLogListResponse
from app.services.audit_logs import list_audit_log_actors, list_audit_logs

# Admin-only end to end: this router surfaces the audit trail written by
# app/services/audit.py, which by definition should never be visible to
# the staff members whose actions it records.
router = APIRouter(
    prefix="/api/audit-logs",
    tags=["Audit Log"],
    dependencies=[Depends(require_role("admin"))],
)


@router.get("", response_model=AuditLogListResponse)
def get_audit_logs(
    entity_type: str | None = Query(default=None),
    action: str | None = Query(default=None),
    user_id: UUID | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    rows, total = list_audit_logs(
        db,
        entity_type=entity_type,
        action=action,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )

    return AuditLogListResponse(
        items=[
            AuditLogListItem(
                id=log.id,
                user_id=log.user_id,
                user_email=email,
                action=log.action,
                entity_type=log.entity_type,
                entity_id=log.entity_id,
                details=log.details,
                created_at=log.created_at,
            )
            for log, email in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/actors", response_model=list[AuditLogActor])
def get_audit_log_actors(db: Session = Depends(get_db)):
    return [
        AuditLogActor(id=user_id, email=email)
        for user_id, email in list_audit_log_actors(db)
    ]
