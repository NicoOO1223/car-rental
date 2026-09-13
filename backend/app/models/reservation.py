import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Reservation(Base):
    __tablename__ = "reservations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id"),
        nullable=False,
    )

    car_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cars.id"),
        nullable=False,
    )

    pickup_location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id"),
        nullable=False,
    )

    return_location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id"),
        nullable=False,
    )

    customer: Mapped["Customer"] = relationship(
    "Customer",
    )

    car: Mapped["Car"] = relationship(
        "Car",
    )

    pickup_location: Mapped["Location"] = relationship(
        "Location",
        foreign_keys=[pickup_location_id],
    )

    return_location: Mapped["Location"] = relationship(
        "Location",
        foreign_keys=[return_location_id],
    )

    # Association-object pattern rather than secondary=, because each line
    # carries its own quantity and price snapshot. delete-orphan is the one
    # place this codebase needs a cascade: replacing the extras set on an
    # edit must delete the dropped rows.
    #
    # Load this with selectinload, never joinedload — it is the only
    # collection relationship in the app, and joinedload against a
    # collection fans out parent rows and breaks db.scalars(...).all().
    extras: Mapped[list["ReservationExtra"]] = relationship(
        "ReservationExtra",
        cascade="all, delete-orphan",
    )

    pickup_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    return_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
    )

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
            "return_at > pickup_at",
            name="valid_reservation_period",
        ),
    )