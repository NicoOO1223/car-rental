import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MaintenanceTask(Base):
    """
    A work order against a car — either MAINTENANCE or CLEANING. Opening
    one drives Car.status to match (so the existing availability filter
    in app/services/availability.py::get_available_cars automatically
    excludes the car from new bookings); completing or cancelling it
    resets Car.status back to AVAILABLE. Unlike Handover, this is 1:many
    — a car accumulates a history of tasks over its lifetime.
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

    notes: Mapped[str | None] = mapped_column(Text)

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
            "status IN ('OPEN','DONE','CANCELLED')",
            name="valid_maintenance_task_status",
        ),
    )
