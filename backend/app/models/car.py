import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Integer, Numeric, String, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.location import Location


class Car(Base):
    __tablename__ = "cars"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    make: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    model: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    year: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    license_plate: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        unique=True,
    )

    category: Mapped[str | None] = mapped_column(
        String(50),
    )

    transmission: Mapped[str | None] = mapped_column(
        String(20),
    )

    fuel_type: Mapped[str | None] = mapped_column(
        String(20),
    )

    seats: Mapped[int | None] = mapped_column(
        Integer,
    )

    price_per_day: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
    )

    current_location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id"),
        nullable=False,
    )

    current_location: Mapped["Location"] = relationship(
        foreign_keys=[current_location_id]
    )

    # The airport this car belongs to. current_location moves with
    # one-way rentals (see app/services/check_outs.py); when the two differ
    # the car is "away from home" and staff are alerted.
    home_location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id"),
        nullable=False,
    )

    home_location: Mapped["Location"] = relationship(
        foreign_keys=[home_location_id]
    )

    @property
    def is_away_from_home(self) -> bool:
        return self.current_location_id != self.home_location_id

    # Customer-facing photo, shown in the booking wizard's vehicle step.
    # Nullable on purpose: the frontend falls back to a category
    # illustration, so a car without a photo is never a blank box.
    image_url: Mapped[str | None] = mapped_column(
        String(500),
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="AVAILABLE",
    )

    # --- Vehicle condition (manually edited; kept separate from
    # MaintenanceTask history, which tracks the work orders themselves) ---
    mileage: Mapped[int | None] = mapped_column(Integer)

    tire_condition: Mapped[str | None] = mapped_column(
        String(20),
    )  # GOOD | FAIR | WORN | NEEDS_REPLACEMENT

    last_oil_change_at: Mapped[date | None] = mapped_column(Date)

    # Technical inspection (the legally required periodic check).
    last_inspection_at: Mapped[date | None] = mapped_column(Date)
    next_inspection_due: Mapped[date | None] = mapped_column(Date)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )