from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.i18n.documents import document_language, format_amount, label
from app.models import Invoice
from app.models.invoice import KIND_CREDIT_NOTE
from app.services.configuration import get_configuration
from app.services.pdf_common import FONT, FONT_BOLD, draw_business_header, format_local

_LEFT = 20 * mm
_RIGHT = A4[0] - 20 * mm

# Column positions (from the left margin) for the lines table.
_QTY_X = 108 * mm
_UNIT_X = 138 * mm


def _line_text(line: dict, language: str) -> str:
    """A line's wording in the invoice's language. Lines issued with a key
    (rental, fees) are translated; an add-on keeps the name the business gave
    it, and a line from before keys existed keeps the English it was issued
    with."""

    key = line.get("key")

    if key:
        return label(language, key, **(line.get("params") or {}))

    return str(line["description"])


def render_invoice_pdf(db: Session, invoice: Invoice) -> bytes:
    """
    Draws an invoice or credit note from what was copied onto it when it was
    issued. The seller, customer, lines, amounts and language come from the
    invoice itself, never from current Configuration or the customer's
    current record, so re-downloading an old invoice always gives the same
    document, even after the business changes its document language.
    """

    buffer = BytesIO()
    doc = canvas.Canvas(buffer, pagesize=A4)
    _, height = A4

    is_credit = invoice.kind == KIND_CREDIT_NOTE
    currency = invoice.currency
    business_zone = get_configuration(db).timezone
    language = document_language(invoice.language)

    def amount(value) -> str:
        return format_amount(value, currency, language)

    y = draw_business_header(
        doc, db, left=_LEFT, top=height - 20 * mm, seller=invoice.seller, language=language
    )

    doc.setFont(FONT_BOLD, 18)
    doc.drawString(
        _LEFT, y, label(language, "invoice.credit_note" if is_credit else "invoice.title")
    )
    y -= 7 * mm

    doc.setFont(FONT, 10)
    doc.drawString(_LEFT, y, label(language, "invoice.number", number=invoice.number))
    y -= 5 * mm
    doc.drawString(
        _LEFT,
        y,
        label(language, "invoice.date", date=format_local(invoice.issued_at, business_zone, language)),
    )
    y -= 5 * mm

    if is_credit and invoice.original_invoice is not None:
        doc.drawString(
            _LEFT,
            y,
            label(language, "invoice.credits_invoice", number=invoice.original_invoice.number),
        )
        y -= 5 * mm

    doc.drawString(
        _LEFT,
        y,
        label(
            language,
            "invoice.booking_reference",
            reference=str(invoice.reservation_id)[:8].upper(),
        ),
    )
    y -= 10 * mm

    doc.setFont(FONT_BOLD, 10)
    doc.drawString(_LEFT, y, label(language, "invoice.billed_to"))
    y -= 5 * mm
    doc.setFont(FONT, 10)

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
    doc.setFont(FONT_BOLD, 9)
    doc.drawString(_LEFT, y, label(language, "invoice.description"))
    doc.drawRightString(_QTY_X + 10 * mm, y, label(language, "invoice.quantity"))
    doc.drawRightString(_UNIT_X + 20 * mm, y, label(language, "invoice.unit_price"))
    doc.drawRightString(_RIGHT, y, label(language, "invoice.amount"))
    y -= 2 * mm
    doc.setStrokeColorRGB(0.8, 0.8, 0.8)
    doc.line(_LEFT, y, _RIGHT, y)
    y -= 5 * mm

    doc.setFont(FONT, 9)

    for line in invoice.lines:
        if y < 60 * mm:
            doc.showPage()
            y = height - 25 * mm
            doc.setFont(FONT, 9)

        doc.drawString(_LEFT, y, _line_text(line, language)[:60])
        doc.drawRightString(_QTY_X + 10 * mm, y, str(line["quantity"]))
        doc.drawRightString(_UNIT_X + 20 * mm, y, amount(line["unit_price"]))
        doc.drawRightString(_RIGHT, y, amount(line["amount"]))
        y -= 5.5 * mm

    y -= 2 * mm
    doc.line(_LEFT, y, _RIGHT, y)
    y -= 7 * mm

    # --- totals --------------------------------------------------------------
    def total_row(text: str, value, bold: bool = False):
        nonlocal y
        doc.setFont(FONT_BOLD if bold else FONT, 10)
        doc.drawString(_UNIT_X - 20 * mm, y, text)
        doc.drawRightString(_RIGHT, y, amount(value))
        y -= 5.5 * mm

    rate = f"{invoice.vat_rate.normalize():f}"

    if invoice.vat_rate > 0:
        if invoice.prices_include_vat:
            total_row(label(language, "invoice.total_vat_included"), invoice.total_amount, bold=True)
            total_row(label(language, "invoice.of_which_vat", rate=rate), invoice.vat_amount)
            total_row(label(language, "invoice.net_amount"), invoice.net_amount)
        else:
            total_row(label(language, "invoice.subtotal"), invoice.net_amount)
            total_row(label(language, "invoice.vat", rate=rate), invoice.vat_amount)
            total_row(label(language, "invoice.total"), invoice.total_amount, bold=True)
    else:
        total_row(label(language, "invoice.total"), invoice.total_amount, bold=True)

    doc.showPage()
    doc.save()

    return buffer.getvalue()
