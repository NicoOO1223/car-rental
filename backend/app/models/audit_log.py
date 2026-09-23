import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column


from app.database import Base


class AuditLog(Base):
    """
    Who did what, to which object, and when — see app/services/audit.py
    for the one function (audit_log()) that should ever write here.

    entity_id is not a real foreign key: it points at whichever table
    entity_type names, so it can't reference a single parent table.
    """

    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # Nullable, ondelete="SET NULL": a deleted user must not be blocked
    # by, or cascade-delete, the audit trail of their past actions — the
    # row survives as evidence with user_id=NULL.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # "<entity_type>.<past-tense verb>", e.g. "reservation.cancelled".
    action: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    entity_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )

    # Small, optional context — never PII. Named `details` because
    # `metadata` is reserved on SQLAlchemy's DeclarativeBase.
    details: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    __table_args__ = (
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
    )
