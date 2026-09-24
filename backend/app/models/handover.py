import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    LargeBinary,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Handover(Base):
    """
    One row per CONFIRMED reservation being finalized at the counter:
    tracks the Stripe payment, the customer's captured signature, and
    the generated rental-agreement PDF. Reaching a generated agreement
    is what flips the parent Reservation to ACTIVE (see
    app/services/handovers.py::generate_agreement).
    """

    __tablename__ = "handovers"

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

    # Permanently nullable, not a temporary migration stage: rows created
    # before this column existed have no real acting user to attribute,
    # and that history is never fabricated. ondelete="SET NULL" so
    # deleting a User row can't be blocked by, or cascade into, old
    # handovers it's attributed on.
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

    # --- Payment ---
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255))
    payment_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    payment_currency: Mapped[str | None] = mapped_column(String(3))

    payment_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
    )  # PENDING | PROCESSING | SUCCEEDED | FAILED | CANCELLED | REFUNDED

    # Null until a payment attempt is made. CASH never gets a
    # stripe_payment_intent_id — it's a direct staff attestation that
    # cash was received, not a Stripe-verified transaction.
    payment_method: Mapped[str | None] = mapped_column(String(10))  # CARD | CASH

    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- Security deposit ---
    # Taken at check-in when a deposit is configured, settled at check-out
    # (see app/services/deposits.py). NULL deposit_status = no deposit was
    # involved (deposits off, or a rental started before they existed).
    # The amount is snapshotted from the configuration when taken.
    deposit_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    deposit_currency: Mapped[str | None] = mapped_column(String(3))
    deposit_method: Mapped[str | None] = mapped_column(String(10))  # CARD | CASH

    # PENDING (card authorization started) -> HELD, then at check-out
    # RELEASED (nothing taken) | CAPTURED | PARTIALLY_CAPTURED | LAPSED (the
    # card hold had expired). CANCELLED/FAILED: the hold never succeeded.
    deposit_status: Mapped[str | None] = mapped_column(String(20))

    # A card deposit is a Stripe authorization (manual capture), not a
    # charge: nothing leaves the customer's account unless it is captured.
    deposit_stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255))
    deposit_held_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deposit_settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deposit_captured_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))

    # --- Refund ---
    # Set together when cancel_reservation() refunds a SUCCEEDED payment
    # (see app/services/reservations.py). Always the full payment_amount —
    # this app has no partial-refund/cancellation-fee policy. CASH
    # refunds never get a stripe_refund_id, same reasoning as
    # payment_method above: it's a staff attestation, not a Stripe call.
    refund_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stripe_refund_id: Mapped[str | None] = mapped_column(String(255))

    # --- Signature ---
    signature_image: Mapped[str | None] = mapped_column(Text)  # base64 PNG data URL
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- Employee signature ---
    # The staff member approving the handover signs after the customer.
    # The signer is recorded from the authenticated session at signing
    # time, never taken from the request. ondelete="SET NULL" like the
    # other user references above; the image and timestamp outlive the
    # account.
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

    # --- Agreement ---
    agreement_pdf: Mapped[bytes | None] = mapped_column(LargeBinary)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

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
            "payment_status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED','REFUNDED')",
            name="valid_handover_payment_status",
        ),
        CheckConstraint(
            "payment_method IN ('CARD','CASH')",
            name="valid_handover_payment_method",
        ),
        CheckConstraint(
            "deposit_status IN ('PENDING','HELD','RELEASED','CAPTURED',"
            "'PARTIALLY_CAPTURED','LAPSED','FAILED','CANCELLED')",
            name="valid_handover_deposit_status",
        ),
        CheckConstraint(
            "deposit_method IN ('CARD','CASH')",
            name="valid_handover_deposit_method",
        ),
    )
