import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ReservationExtra(Base):
    """
    One add-on line on a reservation.

    Everything needed to price and print the line is copied here at booking
    time (code, name, unit price, price unit), so editing the catalog later
    — a price rise, a rename, reclassifying an extra from per-day to
    per-rental, retiring it entirely — can never retroactively change what
    an existing booking costs or how it reads on an already-issued rental
    agreement. extra_id is kept purely so reporting can still group historic
    lines by catalog item.

    Note what is deliberately NOT snapshotted: the line *total*. A PER_DAY
    line legitimately re-prices when the reservation's dates are edited,
    exactly as base_amount already does — see
    app/services/pricing.py::calculate_price_breakdown, which is recomputed
    from the reservation's current dates at handover-payment time.
    """

    __tablename__ = "reservation_extras"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("reservations.id"),
        nullable=False,
    )

    extra_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("extras.id"),
        nullable=False,
    )

    extra: Mapped["Extra"] = relationship(
        "Extra",
    )

    quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
    )

    @property
    def translations(self) -> dict:
        """The catalog's wording in other languages, so a booked line can be
        shown in the reader's language. Names are labels, unlike prices, so
        this reads the current catalog rather than a snapshot."""

        return self.extra.translations if self.extra is not None else {}

    # --- Snapshot of the catalog row as it was when this was booked ---

    extra_code: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    unit_price: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
    )

    price_unit: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        # Two baby seats is quantity=2, never two rows.
        UniqueConstraint(
            "reservation_id",
            "extra_id",
            name="unique_reservation_extra",
        ),
        CheckConstraint(
            "quantity >= 1",
            name="valid_reservation_extra_quantity",
        ),
        CheckConstraint(
            "price_unit IN ('PER_DAY','PER_RENTAL')",
            name="valid_reservation_extra_price_unit",
        ),
    )
