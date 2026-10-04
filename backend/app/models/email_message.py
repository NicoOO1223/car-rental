import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# After this many failed tries a message is given up on (status FAILED) and
# stays in the table for someone to look at.
MAX_ATTEMPTS = 6


class EmailMessage(Base):
    """
    An email waiting to be sent, or already sent: the outbox.

    A message is written in the same transaction as the thing that caused it (a
    booking confirmed, a payment taken), so it exists if and only if that
    happened, and is sent afterwards by the worker in app/services/email_outbox.py.
    That way a slow or unavailable email service never holds up or breaks a
    booking, a failed send is retried, and a message is never sent twice.

    The words are written when the event happens; an attached invoice is drawn at
    send time from the invoice itself, which never changes once issued.
    """

    __tablename__ = "email_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # One message per event: "booking_confirmed:<reservation id>",
    # "receipt:<invoice id>". Queuing the same event again is a no-op.
    dedupe_key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)

    template: Mapped[str] = mapped_column(String(40), nullable=False)
    language: Mapped[str] = mapped_column(String(5), nullable=False)

    to_address: Mapped[str] = mapped_column(String(254), nullable=False)
    to_name: Mapped[str | None] = mapped_column(String(200))
    reply_to: Mapped[str | None] = mapped_column(String(254))

    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body_text: Mapped[str] = mapped_column(Text, nullable=False)
    body_html: Mapped[str] = mapped_column(Text, nullable=False)

    reservation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("reservations.id"))
    # The invoice to attach as a PDF, if any.
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("invoices.id"))

    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    last_error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        CheckConstraint("status IN ('PENDING','SENT','FAILED')", name="valid_email_message_status"),
        CheckConstraint("attempts >= 0", name="email_messages_attempts_not_negative"),
        # What the worker looks for: pending messages that are due.
        Index("ix_email_messages_due", "status", "next_attempt_at"),
        Index("ix_email_messages_reservation_id", "reservation_id"),
    )


class EmailSettings(Base):
    """The one row of email settings an administrator can change from the panel.
    Whether email is set up at all (the sending domain, the connection) is decided
    when the stack is provisioned; this only lets sending be paused and resumed."""

    __tablename__ = "email_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (CheckConstraint("id = 1", name="email_settings_singleton"),)


class EmailTextOverride(Base):
    """A line of an email the business has worded itself, in one language. A line
    without a row here uses the built-in wording (app/i18n/emails.py). An empty
    text means the line is left out of the email."""

    __tablename__ = "email_text_overrides"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    language: Mapped[str] = mapped_column(String(5), primary_key=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
