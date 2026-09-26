import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Index,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CheckOut(Base):
    """
    The return of a rented car, one row per reservation: the vehicle's
    condition, the late/fuel/damage charges that follow from it and their
    payment, and the receiving employee's signature. Completing it is what
    moves the reservation to COMPLETED and the car to the return airport
    (see app/services/check_outs.py). The counterpart of Handover, which
    covers the start of the rental.
    """

    __tablename__ = "check_outs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("reservations.id"),
        nullable=False,
        unique=True,
    )

    reservation: Mapped["Reservation"] = relationship("Reservation")

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # --- Vehicle condition ---
    # When the car was actually brought back: fixed when the condition is
    # first recorded, so waiting on a card payment doesn't add late hours.
    returned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    return_mileage: Mapped[int] = mapped_column(Integer, nullable=False)

    # Eighths of a tank, 0 (empty) to 8 (full).
    fuel_eighths: Mapped[int] = mapped_column(Integer, nullable=False)

    damage_reported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    damage_notes: Mapped[str | None] = mapped_column(Text)

    # Typed in by the employee, up to the configured maximum.
    damage_charge: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00")
    )

    # When damage is reported, the repair window the maintenance task is
    # opened for on completion.
    damage_task_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    damage_task_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- Charges ---
    late_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    late_fee: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00")
    )
    fuel_fee: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00")
    )

    late_fee_waived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fuel_fee_waived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    waiver_reason: Mapped[str | None] = mapped_column(Text)

    total_charge: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00")
    )

    # --- Security deposit settlement ---
    # How much of the held deposit went to these charges, and how much goes
    # back to the customer. Both 0 until settled, or when no deposit was held.
    deposit_applied: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00")
    )
    deposit_returned: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0.00")
    )
    deposit_settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- Payment (same shape as Handover's) ---
    # Covers only what the deposit didn't: total_charge - deposit_applied.
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(
        String(255), index=True
    )
    payment_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    payment_currency: Mapped[str | None] = mapped_column(String(3))

    payment_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
    )  # PENDING | PROCESSING | SUCCEEDED | FAILED | CANCELLED

    payment_method: Mapped[str | None] = mapped_column(String(10))  # CARD | CASH
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- Employee signature (the employee who received the car) ---
    employee_signature_image: Mapped[str | None] = mapped_column(Text)  # base64 PNG data URL
    employee_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    employee_signed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    employee_signer: Mapped["User | None"] = relationship(
        "User", foreign_keys=[employee_signed_by]
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
            "fuel_eighths BETWEEN 0 AND 8",
            name="valid_check_out_fuel_eighths",
        ),
        CheckConstraint(
            "payment_status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED')",
            name="valid_check_out_payment_status",
        ),
        CheckConstraint(
            "payment_method IN ('CARD','CASH')",
            name="valid_check_out_payment_method",
        ),
        Index("ix_check_outs_paid_at", "paid_at"),
    )
