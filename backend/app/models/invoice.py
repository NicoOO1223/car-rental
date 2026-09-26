import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

KIND_INVOICE = "INVOICE"
KIND_CREDIT_NOTE = "CREDIT_NOTE"


class InvoiceCounter(Base):
    """
    The last invoice sequence number handed out. One row, locked with
    SELECT ... FOR UPDATE while a number is allocated, in the same
    transaction that inserts the invoice. If that transaction rolls back the
    increment rolls back with it, so the sequence never has a gap: a
    requirement for invoice numbers in most tax systems.
    """

    __tablename__ = "invoice_counter"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    last_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (CheckConstraint("id = 1", name="invoice_counter_singleton"),)


class Invoice(Base):
    """
    A tax document for money taken (kind INVOICE) or given back (kind
    CREDIT_NOTE, with negative amounts, pointing at the invoice it
    reverses).

    Everything printed on it is copied in at issue time: the seller and
    customer details, every line, the VAT rate and the amounts. Changing
    Configuration, editing the customer or repricing a reservation later
    never alters an invoice that has been issued. Invoices are never edited
    or deleted; a mistake is corrected with a credit note.
    """

    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # "INV-000123". Unique, and allocated from InvoiceCounter.
    number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)

    kind: Mapped[str] = mapped_column(String(12), nullable=False)

    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reservations.id"), nullable=False, index=True
    )
    # The rental payment this document is about. Together with `kind` it is
    # unique, so a payment gets at most one invoice and one credit note.
    handover_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handovers.id"), nullable=False
    )
    # For a credit note: the invoice it reverses.
    original_invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoices.id"), nullable=True
    )

    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    # [{"description": ..., "quantity": ..., "unit_price": ..., "amount": ...}]
    lines: Mapped[list] = mapped_column(JSONB, nullable=False)

    prices_include_vat: Mapped[bool] = mapped_column(Boolean, nullable=False)
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    # Who issued it and to whom, as they were on the day.
    seller: Mapped[dict] = mapped_column(JSONB, nullable=False)
    customer: Mapped[dict] = mapped_column(JSONB, nullable=False)

    original_invoice: Mapped["Invoice | None"] = relationship(
        remote_side="Invoice.id", lazy="joined"
    )

    __table_args__ = (
        CheckConstraint("kind IN ('INVOICE','CREDIT_NOTE')", name="valid_invoice_kind"),
        UniqueConstraint("handover_id", "kind", name="unique_invoice_per_payment_and_kind"),
    )
