from decimal import Decimal
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.models import Invoice
from app.models.invoice import KIND_CREDIT_NOTE
from app.services.configuration import get_configuration
from app.services.pdf_common import draw_business_header, format_local

_LEFT = 20 * mm
_RIGHT = A4[0] - 20 * mm

# Column positions (from the left margin) for the lines table.
_QTY_X = 108 * mm
_UNIT_X = 138 * mm


def _amount(value, currency: str) -> str:
    return f"{Decimal(str(value)):.2f} {currency.upper()}"


def render_invoice_pdf(db: Session, invoice: Invoice) -> bytes:
    """
    Draws an invoice or credit note from what was copied onto it when it was
    issued. The seller, customer, lines and amounts come from the invoice
    itself, never from current Configuration or the customer's current
    record, so re-downloading an old invoice always gives the same document.
    """

    buffer = BytesIO()
    doc = canvas.Canvas(buffer, pagesize=A4)
    _, height = A4

    is_credit = invoice.kind == KIND_CREDIT_NOTE
    currency = invoice.currency
    business_zone = get_configuration(db).timezone

    y = draw_business_header(doc, db, left=_LEFT, top=height - 20 * mm, seller=invoice.seller)

    doc.setFont("Helvetica-Bold", 18)
    doc.drawString(_LEFT, y, "Credit note" if is_credit else "Invoice")
    y -= 7 * mm

    doc.setFont("Helvetica", 10)
    doc.drawString(_LEFT, y, f"Number: {invoice.number}")
    y -= 5 * mm
    doc.drawString(_LEFT, y, f"Date: {format_local(invoice.issued_at, business_zone)}")
    y -= 5 * mm

    if is_credit and invoice.original_invoice is not None:
        doc.drawString(_LEFT, y, f"Credits invoice: {invoice.original_invoice.number}")
        y -= 5 * mm

    doc.drawString(_LEFT, y, f"Booking reference: {str(invoice.reservation_id)[:8].upper()}")
    y -= 10 * mm

    doc.setFont("Helvetica-Bold", 10)
    doc.drawString(_LEFT, y, "Billed to")
    y -= 5 * mm
    doc.setFont("Helvetica", 10)

    customer = invoice.customer
    for text in (
        customer.get("name"),
        customer.get("address"),
        customer.get("postal_code"),
        customer.get("email"),
    ):
        if text:
            doc.drawString(_LEFT, y, str(text))
            y -= 5 * mm

    y -= 6 * mm

    # --- lines ---------------------------------------------------------------
    doc.setFont("Helvetica-Bold", 9)
    doc.drawString(_LEFT, y, "Description")
    doc.drawRightString(_QTY_X + 10 * mm, y, "Qty")
    doc.drawRightString(_UNIT_X + 20 * mm, y, "Unit price")
    doc.drawRightString(_RIGHT, y, "Amount")
    y -= 2 * mm
    doc.setStrokeColorRGB(0.8, 0.8, 0.8)
    doc.line(_LEFT, y, _RIGHT, y)
    y -= 5 * mm

    doc.setFont("Helvetica", 9)

    for line in invoice.lines:
        if y < 60 * mm:
            doc.showPage()
            y = height - 25 * mm
            doc.setFont("Helvetica", 9)

        doc.drawString(_LEFT, y, str(line["description"])[:60])
        doc.drawRightString(_QTY_X + 10 * mm, y, str(line["quantity"]))
        doc.drawRightString(_UNIT_X + 20 * mm, y, _amount(line["unit_price"], currency))
        doc.drawRightString(_RIGHT, y, _amount(line["amount"], currency))
        y -= 5.5 * mm

    y -= 2 * mm
    doc.line(_LEFT, y, _RIGHT, y)
    y -= 7 * mm

    # --- totals --------------------------------------------------------------
    def total_row(label: str, value, bold: bool = False):
        nonlocal y
        doc.setFont("Helvetica-Bold" if bold else "Helvetica", 10)
        doc.drawString(_UNIT_X - 20 * mm, y, label)
        doc.drawRightString(_RIGHT, y, _amount(value, currency))
        y -= 5.5 * mm

    rate = f"{invoice.vat_rate.normalize():f}"

    if invoice.vat_rate > 0:
        if invoice.prices_include_vat:
            total_row("Total (VAT included)", invoice.total_amount, bold=True)
            total_row(f"of which VAT {rate}%", invoice.vat_amount)
            total_row("Net amount", invoice.net_amount)
        else:
            total_row("Subtotal", invoice.net_amount)
            total_row(f"VAT {rate}%", invoice.vat_amount)
            total_row("Total", invoice.total_amount, bold=True)
    else:
        total_row("Total", invoice.total_amount, bold=True)

    doc.showPage()
    doc.save()

    return buffer.getvalue()
