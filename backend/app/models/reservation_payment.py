import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ReservationPayment(Base):
    """
    The share of a rental a renter pays online when booking (kind PREPAYMENT).
    The rest is paid at the counter and lives on the Handover.

    The payment columns are named and used exactly like the Handover's, so
    the same rules for moving a payment between states
    (app/services/handovers.py::apply_payment_intent_status) apply to both.
    One prepayment per reservation, and an invoice of its own (Invoice.payment_id).
    """

    __tablename__ = "reservation_payments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reservations.id"), nullable=False
    )

    kind: Mapped[str] = mapped_column(String(12), nullable=False, default="PREPAYMENT")

    payment_method: Mapped[str | None] = mapped_column(String(10))  # CARD
    payment_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    payment_currency: Mapped[str | None] = mapped_column(String(3))
    payment_status: Mapped[str] = mapped_column(String(12), nullable=False, default="PENDING")
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    refund_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stripe_refund_id: Mapped[str | None] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
        default=datetime.utcnow, onupdate=datetime.utcnow,
    )

    __table_args__ = (
        CheckConstraint("kind IN ('PREPAYMENT')", name="valid_reservation_payment_kind"),
        CheckConstraint(
            "payment_status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED','REFUNDED')",
            name="valid_reservation_payment_status",
        ),
        Index("ix_reservation_payments_reservation_id", "reservation_id"),
        Index("ix_reservation_payments_intent", "stripe_payment_intent_id", unique=True),
        Index(
            "uq_reservation_payments_one_prepayment",
            "reservation_id",
            unique=True,
            postgresql_where=text("kind = 'PREPAYMENT'"),
        ),
    )
