from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models import Invoice


class InvoiceResponse(BaseModel):
    id: UUID
    number: str
    kind: str  # INVOICE | CREDIT_NOTE
    reservation_id: UUID
    issued_at: datetime
    currency: str

    prices_include_vat: bool
    vat_rate: float
    net_amount: float
    vat_amount: float
    total_amount: float

    # For a credit note: the number of the invoice it reverses.
    credits_invoice_number: str | None

    @classmethod
    def from_model(cls, invoice: Invoice) -> "InvoiceResponse":
        return cls(
            id=invoice.id,
            number=invoice.number,
            kind=invoice.kind,
            reservation_id=invoice.reservation_id,
            issued_at=invoice.issued_at,
            currency=invoice.currency,
            prices_include_vat=invoice.prices_include_vat,
            vat_rate=float(invoice.vat_rate),
            net_amount=float(invoice.net_amount),
            vat_amount=float(invoice.vat_amount),
            total_amount=float(invoice.total_amount),
            credits_invoice_number=(
                invoice.original_invoice.number
                if invoice.original_invoice is not None
                else None
            ),
        )
