import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MaintenanceTask(Base):
    """
    A work order against a car — either MAINTENANCE or CLEANING — that
    takes the car out of service for the window [starts_at, ends_at).
    Availability is derived from that window (see
    app/services/availability.py), not from Car.status: a future window
    doesn't block the car today, and the car frees itself once the window
    ends. A NULL ends_at marks a task created before windows existed; it
    is still carried by Car.status, as it always was.
    Unlike Handover, this is 1:many — a car accumulates a history of tasks
    over its lifetime.
    """

    __tablename__ = "maintenance_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    car_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cars.id"),
        nullable=False,
    )

    car: Mapped["Car"] = relationship("Car")

    task_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )  # MAINTENANCE | CLEANING

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="OPEN",
    )  # OPEN | DONE | CANCELLED

    # What kind of MAINTENANCE this is (CLEANING tasks have none). NULL
    # also covers tasks logged before categories existed.
    category: Mapped[str | None] = mapped_column(String(30))

    notes: Mapped[str | None] = mapped_column(Text)

    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "task_type IN ('MAINTENANCE','CLEANING')",
            name="valid_maintenance_task_type",
        ),
        CheckConstraint(
            "category IS NULL OR category IN "
            "('DAMAGE_REPAIR','TECHNICAL_INSPECTION','ROUTINE_SERVICE','OTHER')",
            name="valid_maintenance_task_category",
        ),
        CheckConstraint(
            "status IN ('OPEN','DONE','CANCELLED')",
            name="valid_maintenance_task_status",
        ),
    )
