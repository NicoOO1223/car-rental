import base64
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.services.extras import selections_from_reservation
from app.services.pricing import calculate_price_breakdown

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


def render_agreement_pdf(reservation, car, handover) -> bytes:
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
    y -= 4 * mm

    heading("Vehicle")
    line(f"{car.make} {car.model} ({car.year}) — {car.license_plate}")
    y -= 4 * mm

    heading("Rental Period")
    line(f"Pickup: {reservation.pickup_at.isoformat()} at {reservation.pickup_location.name}")
    line(f"Return: {reservation.return_at.isoformat()} at {reservation.return_location.name}")
    y -= 4 * mm

    heading("Payment")
    currency = handover.payment_currency.upper() if handover.payment_currency else ""
    breakdown = calculate_price_breakdown(
        car.price_per_day,
        reservation.pickup_at,
        reservation.return_at,
        reservation.pickup_location_id,
        reservation.return_location_id,
        selections_from_reservation(reservation),
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
    line(f"Paid at: {handover.paid_at.isoformat() if handover.paid_at else 'N/A'}")
    y -= 4 * mm

    heading("Terms & Conditions")
    for terms_line in TERMS_LINES:
        line(terms_line, size=8, gap=4.5 * mm)
    y -= 4 * mm

    heading("Customer Signature")

    if handover.signature_image:
        raw = handover.signature_image
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
        line("(no signature on file)")

    doc.showPage()
    doc.save()

    return buffer.getvalue()
