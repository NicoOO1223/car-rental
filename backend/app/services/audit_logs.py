from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AuditLog, User


def list_audit_logs(
    db: Session,
    *,
    entity_type: str | None = None,
    action: str | None = None,
    user_id: UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[tuple[AuditLog, str | None]], int]:
    """
    Returns (rows, total). Each row is (AuditLog, user_email) via a LEFT
    JOIN against users, so a since-deleted actor (user_id set NULL per
    AuditLog.user_id's ON DELETE SET NULL) still renders without dropping
    the row.
    """
    filters = []

    if entity_type is not None:
        filters.append(AuditLog.entity_type == entity_type)
    if action is not None:
        filters.append(AuditLog.action == action)
    if user_id is not None:
        filters.append(AuditLog.user_id == user_id)
    if start_date is not None:
        filters.append(
            AuditLog.created_at >= datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        )
    if end_date is not None:
        filters.append(
            AuditLog.created_at
            < datetime.combine(end_date, time.min, tzinfo=timezone.utc) + timedelta(days=1)
        )

    total = db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0

    rows = db.execute(
        select(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(*filters)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return [(row[0], row[1]) for row in rows], total


def list_audit_log_actors(db: Session) -> list[tuple[UUID, str]]:
    """
    Distinct users who have ever produced an audit-log row — feeds the
    admin filter dropdown only. Not a general user directory: no CRUD, no
    listing of users who've never acted.
    """
    rows = db.execute(
        select(AuditLog.user_id, User.email)
        .join(User, User.id == AuditLog.user_id)
        .distinct()
        .order_by(User.email)
    ).all()

    return [(row[0], row[1]) for row in rows]
