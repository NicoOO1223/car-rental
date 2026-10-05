import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CustomerAccount(Base):
    """A renter's own login on the storefront. Entirely separate from the
    staff `users` table: different table, different token audience."""

    __tablename__ = "customer_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)

    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    first_name: Mapped[str] = mapped_column(String(100), nullable=False)

    last_name: Mapped[str] = mapped_column(String(100), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # When the owner proved they can read mail sent to this address (the link in the
    # verification email, or a password reset). Until then the account cannot see or
    # claim bookings. Accounts that existed before verification are unverified.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The language of the page they registered on: the language of their account emails.
    language: Mapped[str | None] = mapped_column(String(5))

    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Tokens issued before this moment are refused: how logging out ends a
    # session that is otherwise valid until it expires.
    token_valid_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CustomerAccountBooking(Base):
    """A booking an account owns. Linked only by creating the booking while
    logged in, or by proving the reference and booker's email together (the
    same proof the guest lookup uses). Never by email alone: addresses are not
    verified at registration, so matching on them would show one person's
    bookings to anyone who registers with their address."""

    __tablename__ = "customer_account_bookings"
    __table_args__ = (UniqueConstraint("account_id", "reservation_id", name="uq_account_booking"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customer_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )

    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
