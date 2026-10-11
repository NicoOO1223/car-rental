import base64
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.i18n.documents import document_language, format_amount, label
from app.services.extras import localized_name, selections_from_reservation, translations_by_code
from app.services.booking_prices import reservation_price_breakdown
from app.services.prepayments import prepaid_amount
from app.services.configuration import get_configuration, vat_terms
from app.services.pdf_common import (
    FONT,
    FONT_BOLD,
    draw_business_header,
    format_local,
    wrap_text,
)


def agreement_terms(db: Session) -> dict:
    """
    The terms exactly as the agreement will print them, so the customer can read
    what they are signing before they sign. The business's own wording if it has
    set any, else the built-in placeholder, which is flagged because it is not
    real legal copy.
    """

    configuration = get_configuration(db)
    language = document_language(configuration.document_language)
    own = (configuration.agreement_terms or "").strip()

    return {
        "language": language,
        "title": label(language, "agreement.terms"),
        "terms": own or label(language, "agreement.default_terms"),
        "is_placeholder": not own,
    }


def render_agreement_pdf(db: Session, reservation, car, handover) -> bytes:
    """
    Draws the rental agreement in the business's current document language
    (Configuration). The wording of the terms is the business's own if it
    has set any; otherwise the built-in placeholder text, which is not real
    legal copy and must be reviewed before it is relied on.
    """

    configuration = get_configuration(db)
    language = document_language(configuration.document_language)

    buffer = BytesIO()
    doc = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    left = 20 * mm
    y = height - 20 * mm

    def heading(text):
        nonlocal y
        doc.setFont(FONT_BOLD, 12)
        doc.drawString(left, y, text)
        y -= 6 * mm
        doc.setFont(FONT, 10)

    def line(text, size=10, gap=5 * mm):
        nonlocal y

        # Break to a new page before running into the bottom margin. The
        # itemization grew open-ended when add-ons were introduced, and the
        # signature block below needs 30 mm of clear space.
        if y < 40 * mm:
            doc.showPage()
            y = height - 20 * mm

        doc.setFont(FONT, size)
        doc.drawString(left, y, text)
        y -= gap

    y = draw_business_header(doc, db, left=left, top=y, language=language)

    doc.setFont(FONT_BOLD, 16)
    doc.drawString(left, y, label(language, "agreement.title"))
    y -= 8 * mm

    doc.setFont(FONT, 9)
    doc.drawString(left, y, label(language, "agreement.reservation_id", id=reservation.id))
    y -= 10 * mm

    customer = reservation.customer

    heading(label(language, "agreement.customer"))
    line(f"{customer.first_name} {customer.last_name}")
    line(label(language, "agreement.date_of_birth", date=customer.date_of_birth))
    line(
        label(
            language,
            "agreement.address",
            address=customer.address,
            postal_code=customer.postal_code,
        )
    )
    if customer.identity_verified_at:
        line(
            label(
                language,
                "agreement.identity_verified",
                date=f"{customer.identity_verified_at:%Y-%m-%d}",
                document_type=customer.identity_document_type,
                country=customer.identity_issuing_country,
            )
        )
    y -= 4 * mm

    heading(label(language, "agreement.vehicle"))
    line(f"{car.make} {car.model} ({car.year}) — {car.license_plate}")
    y -= 4 * mm

    heading(label(language, "agreement.rental_period"))
    # Each time is written in the timezone of the place it happens at.
    line(
        label(
            language,
            "agreement.pickup",
            time=format_local(
                reservation.pickup_at, reservation.pickup_location.timezone, language
            ),
            location=reservation.pickup_location.name,
        )
    )
    line(
        label(
            language,
            "agreement.return",
            time=format_local(
                reservation.return_at, reservation.return_location.timezone, language
            ),
            location=reservation.return_location.name,
        )
    )
    y -= 4 * mm

    heading(label(language, "agreement.payment"))
    currency = handover.payment_currency.upper() if handover.payment_currency else ""
    breakdown = reservation_price_breakdown(db, reservation, car, configuration)

    def money_line(name: str, value) -> None:
        line(f"{name}: {format_amount(value, currency, language)}")

    money_line(label(language, "agreement.base_rental"), breakdown.base_amount)
    if breakdown.short_term_fee:
        money_line(label(language, "agreement.short_term_fee"), breakdown.short_term_fee)
    if breakdown.airport_change_fee:
        money_line(label(language, "agreement.airport_change_fee"), breakdown.airport_change_fee)
    extra_words = translations_by_code(db, (line.code for line in breakdown.extras))

    for extra_line in breakdown.extras:
        quantity_label = f"{extra_line.quantity} x " if extra_line.quantity > 1 else ""
        extra_name = localized_name(extra_line.name, extra_words.get(extra_line.code), language)
        money_line(f"{quantity_label}{extra_name}", extra_line.amount)
    if breakdown.adjustment:
        reason = (reservation.price_adjustment_reason or "").strip()
        adjustment_name = label(language, "agreement.price_adjustment")
        money_line(f"{adjustment_name}: {reason}" if reason else adjustment_name, breakdown.adjustment)
    amount = handover.payment_amount if handover.payment_amount is not None else breakdown.total_amount
    online = prepaid_amount(db, reservation.id)

    if online > 0:
        # Part (or all) of the rental was paid on the website before pickup.
        money_line(label(language, "agreement.paid_online"), online)
        money_line(label(language, "agreement.paid_at_counter"), amount)
    else:
        money_line(label(language, "agreement.total_paid"), amount)
    line(
        label(
            language,
            "agreement.paid_at",
            time=format_local(handover.paid_at, configuration.timezone, language),
        )
    )
    y -= 4 * mm

    heading(label(language, "agreement.terms"))
    # The business's own wording if it has set any (printed exactly as
    # written, in whatever language it wrote it), else the placeholder.
    terms = agreement_terms(db)["terms"]

    for terms_line in wrap_text(terms, size=8, width=width - 2 * left):
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
    heading(label(language, "agreement.customer_signature"))
    signature_block(handover.signature_image, label(language, "agreement.no_signature"))

    ensure_space(65 * mm)
    heading(label(language, "agreement.approved_by"))

    if handover.employee_signer is not None:
        line(label(language, "agreement.employee", email=handover.employee_signer.email))

    if handover.employee_signed_at:
        line(
            label(
                language,
                "agreement.signed_at",
                time=format_local(handover.employee_signed_at, configuration.timezone, language),
            )
        )

    signature_block(
        handover.employee_signature_image, label(language, "agreement.no_employee_signature")
    )

    doc.showPage()
    doc.save()

    return buffer.getvalue()
