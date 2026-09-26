import base64
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.services.extras import selections_from_reservation
from app.services.pricing import calculate_price_breakdown
from app.services.configuration import get_configuration
from app.services.pdf_common import draw_business_header, format_local, wrap_text

# Placeholder rental terms — not real legal copy. Review/replace with actual
# terms drafted for this business before relying on this document.
TERMS_LINES = [
    "The customer agrees to return the vehicle in the same condition as",
    "received, subject to normal wear and tear, at the agreed return",
    "location and time. The customer is responsible for all traffic",
    "violations, tolls, and fines incurred during the rental period.",
    "Fuel policy: same-to-same. Full payment has been collected in advance",
    "as recorded below.",
]


def render_agreement_pdf(db: Session, reservation, car, handover) -> bytes:
    buffer = BytesIO()
    doc = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    left = 20 * mm
    y = height - 20 * mm

    def heading(text):
        nonlocal y
        doc.setFont("Helvetica-Bold", 12)
        doc.drawString(left, y, text)
        y -= 6 * mm
        doc.setFont("Helvetica", 10)

    def line(text, size=10, gap=5 * mm):
        nonlocal y

        # Break to a new page before running into the bottom margin. The
        # itemization grew open-ended when add-ons were introduced, and the
        # signature block below needs 30 mm of clear space.
        if y < 40 * mm:
            doc.showPage()
            y = height - 20 * mm

        doc.setFont("Helvetica", size)
        doc.drawString(left, y, text)
        y -= gap

    y = draw_business_header(doc, db, left=left, top=y)

    doc.setFont("Helvetica-Bold", 16)
    doc.drawString(left, y, "Vehicle Rental Agreement")
    y -= 8 * mm

    doc.setFont("Helvetica", 9)
    doc.drawString(left, y, f"Reservation ID: {reservation.id}")
    y -= 10 * mm

    heading("Customer")
    line(f"{reservation.customer.first_name} {reservation.customer.last_name}")
    line(f"Date of birth: {reservation.customer.date_of_birth}")
    line(f"Address: {reservation.customer.address}, {reservation.customer.postal_code}")
    if reservation.customer.identity_verified_at:
        line(
            f"Identity verified via Stripe Identity on "
            f"{reservation.customer.identity_verified_at:%Y-%m-%d} "
            f"({reservation.customer.identity_document_type}, "
            f"{reservation.customer.identity_issuing_country})"
        )
    y -= 4 * mm

    heading("Vehicle")
    line(f"{car.make} {car.model} ({car.year}) — {car.license_plate}")
    y -= 4 * mm

    heading("Rental Period")
    # Each time is written in the timezone of the place it happens at.
    line(
        f"Pickup: {format_local(reservation.pickup_at, reservation.pickup_location.timezone)}"
        f" at {reservation.pickup_location.name}"
    )
    line(
        f"Return: {format_local(reservation.return_at, reservation.return_location.timezone)}"
        f" at {reservation.return_location.name}"
    )
    y -= 4 * mm

    heading("Payment")
    currency = handover.payment_currency.upper() if handover.payment_currency else ""
    configuration = get_configuration(db)
    breakdown = calculate_price_breakdown(
        car.price_per_day,
        reservation.pickup_at,
        reservation.return_at,
        reservation.pickup_location_id,
        reservation.return_location_id,
        short_term_threshold_days=configuration.short_term_threshold_days,
        short_term_fee=configuration.short_term_fee,
        airport_change_fee=configuration.airport_change_fee,
        extras=selections_from_reservation(reservation),
    )
    line(f"Base rental: {breakdown.base_amount:.2f} {currency}".strip())
    if breakdown.short_term_fee:
        line(f"Short-term rental fee: {breakdown.short_term_fee:.2f} {currency}".strip())
    if breakdown.airport_change_fee:
        line(f"Airport change fee: {breakdown.airport_change_fee:.2f} {currency}".strip())
    for extra_line in breakdown.extras:
        quantity_label = f"{extra_line.quantity} x " if extra_line.quantity > 1 else ""
        line(
            f"{quantity_label}{extra_line.name}: "
            f"{extra_line.amount:.2f} {currency}".strip()
        )
    amount = handover.payment_amount if handover.payment_amount is not None else breakdown.total_amount
    line(f"Total paid: {amount:.2f} {currency}".strip())
    line(f"Paid at: {format_local(handover.paid_at, configuration.timezone)}")
    y -= 4 * mm

    heading("Terms & Conditions")
    # The business's own wording if it has set any, else the placeholder.
    custom_terms = get_configuration(db).agreement_terms

    if custom_terms:
        terms_lines = wrap_text(custom_terms, size=8, width=width - 2 * left)
    else:
        terms_lines = TERMS_LINES

    for terms_line in terms_lines:
        line(terms_line, size=8, gap=4.5 * mm)
    y -= 4 * mm

    def ensure_space(needed) -> None:
        nonlocal y

        if y < needed:
            doc.showPage()
            y = height - 20 * mm

    def signature_block(image_data: str | None, missing_text: str) -> None:
        nonlocal y

        if image_data:
            raw = image_data
            if "," in raw:
                _, raw = raw.split(",", 1)
            image_bytes = base64.b64decode(raw)
            image = ImageReader(BytesIO(image_bytes))
            doc.drawImage(
                image,
                left,
                y - 25 * mm,
                width=60 * mm,
                height=25 * mm,
                preserveAspectRatio=True,
                mask="auto",
            )
            y -= 30 * mm
        else:
            line(missing_text)

    ensure_space(50 * mm)
    heading("Customer Signature")
    signature_block(handover.signature_image, "(no signature on file)")

    ensure_space(65 * mm)
    heading("Approved by (employee)")

    if handover.employee_signer is not None:
        line(f"Employee: {handover.employee_signer.email}")

    if handover.employee_signed_at:
        line(f"Signed at: {format_local(handover.employee_signed_at, configuration.timezone)}")

    signature_block(
        handover.employee_signature_image, "(no employee signature on file)"
    )

    doc.showPage()
    doc.save()

    return buffer.getvalue()
