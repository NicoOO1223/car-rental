from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.errors import NotFoundError
from app.database import get_db
from app.dependencies import require_authenticated_user
from app.models import Reservation
from app.schemas.invoice import InvoiceResponse
from app.services.invoice_pdf import render_invoice_pdf
from app.services.invoices import get_invoice, list_invoices_for_reservation

router = APIRouter(
    prefix="/api",
    tags=["Invoices"],
    dependencies=[Depends(require_authenticated_user)],
)


@router.get(
    "/reservations/{reservation_id}/invoices",
    response_model=list[InvoiceResponse],
)
def get_reservation_invoices(reservation_id: UUID, db: Session = Depends(get_db)):
    if db.get(Reservation, reservation_id) is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    return [
        InvoiceResponse.from_model(invoice)
        for invoice in list_invoices_for_reservation(db, reservation_id)
    ]


@router.get("/invoices/{invoice_id}/pdf")
def download_invoice_pdf(invoice_id: UUID, db: Session = Depends(get_db)):
    invoice = get_invoice(db, invoice_id)

    if invoice is None:
        raise NotFoundError("invoice.not_found", "Invoice not found.")

    return Response(
        content=render_invoice_pdf(db, invoice),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{invoice.number}.pdf"'},
    )
