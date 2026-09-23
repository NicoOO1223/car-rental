import uuid
from datetime import date, datetime
from types import SimpleNamespace

from sqlalchemy import CheckConstraint, Date, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    first_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    last_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    date_of_birth: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    address: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    postal_code: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    # Nullable so existing rows created before these fields were added
    # remain valid — new bookings are required to supply both (enforced
    # in CustomerCreate, not at the DB level).
    phone_number: Mapped[str | None] = mapped_column(
        String(30),
    )

    email: Mapped[str | None] = mapped_column(
        String(255),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    # --- Identity verification (Stripe Identity) ---
    # Minimal tier only: status + non-sensitive fields readable with the
    # plain Stripe secret key. No document number, DOB, or images are
    # ever stored here — see app/services/identity_verification.py.
    identity_verification_session_id: Mapped[str | None] = mapped_column(String(255))
    identity_verification_status: Mapped[str | None] = mapped_column(String(20))
    identity_document_type: Mapped[str | None] = mapped_column(String(50))
    identity_issuing_country: Mapped[str | None] = mapped_column(String(2))
    identity_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- Right to erasure (GDPR Art. 17) ---
    # Set once this customer's PII has been anonymized in place. The row
    # itself is never deleted — Reservation/Handover rows reference it
    # with no ondelete cascade, and the business still needs those rows
    # for its own accounting/legal record-keeping. Once set, the
    # PII columns above hold fixed placeholder values, not real data —
    # see app/services/data_privacy.py.
    anonymized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "identity_verification_status IN "
            "('requires_input','processing','verified','canceled')",
            name="valid_customer_identity_verification_status",
        ),
    )

    @property
    def identity_verification(self) -> SimpleNamespace | None:
        """Groups the flat identity_* columns for CustomerResponse's
        nested `identity_verification` field. None until a verification
        session has been started."""

        if self.identity_verification_status is None:
            return None

        return SimpleNamespace(
            status=self.identity_verification_status,
            document_type=self.identity_document_type,
            issuing_country=self.identity_issuing_country,
            verified_at=self.identity_verified_at,
        )