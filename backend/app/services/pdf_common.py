"""Pieces shared by every PDF this app produces (the rental agreement, and
invoices): the business letterhead and wrapped free text."""

from io import BytesIO

from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.lib.utils import simpleSplit
from sqlalchemy.orm import Session

from app.services.branding import get_logo
from app.services.configuration import get_configuration
from app.services.timezones import zone

LOGO_MAX_WIDTH = 40 * mm
LOGO_MAX_HEIGHT = 18 * mm


def format_local(instant, timezone_name: str | None) -> str:
    """A moment as people at that place read it: "2040-06-15 10:00 CEST".
    Printed documents must say which timezone, since the reader may not be
    where the rental happened."""

    if instant is None:
        return "N/A"

    from datetime import timezone as _utc

    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=_utc.utc)

    local = instant.astimezone(zone(timezone_name))

    return f"{local:%Y-%m-%d %H:%M} {local.tzname()}"


def wrap_text(text: str, *, font: str = "Helvetica", size: float = 10, width: float) -> list[str]:
    """Word-wraps free text (which may contain line breaks) to a width in
    points. Blank lines are kept as paragraph gaps."""

    lines: list[str] = []

    for paragraph in text.splitlines():
        if not paragraph.strip():
            lines.append("")
            continue

        lines.extend(simpleSplit(paragraph, font, size, width))

    return lines


def draw_business_header(doc, db: Session, *, left: float, top: float) -> float:
    """
    Draws the letterhead: logo (if uploaded), trading name, and whichever of
    legal name, address, phone, email and VAT id are filled in. Returns the
    y position just below it, for the caller to continue from.
    """

    configuration = get_configuration(db)
    logo = get_logo(db)

    text_left = left
    logo_bottom = top

    if logo is not None:
        try:
            image = ImageReader(BytesIO(logo.content))
            image_width, image_height = image.getSize()
            scale = min(LOGO_MAX_WIDTH / image_width, LOGO_MAX_HEIGHT / image_height)
            draw_width = image_width * scale
            draw_height = image_height * scale

            doc.drawImage(
                image,
                left,
                top - draw_height,
                width=draw_width,
                height=draw_height,
                mask="auto",
            )

            text_left = left + draw_width + 6 * mm
            logo_bottom = top - draw_height
        except Exception:
            # A logo that cannot be drawn must never stop an agreement or an
            # invoice from being produced.
            text_left = left

    y = top - 4 * mm

    doc.setFont("Helvetica-Bold", 13)
    doc.drawString(text_left, y, configuration.business_name)
    y -= 5 * mm

    doc.setFont("Helvetica", 8)

    detail_lines = []

    if configuration.legal_name:
        detail_lines.append(configuration.legal_name)

    detail_lines.extend(
        part.strip() for part in configuration.address.splitlines() if part.strip()
    )

    contact = " · ".join(
        value for value in (configuration.phone, configuration.email) if value
    )

    if contact:
        detail_lines.append(contact)

    if configuration.vat_id:
        detail_lines.append(f"VAT ID: {configuration.vat_id}")

    for detail in detail_lines:
        doc.drawString(text_left, y, detail)
        y -= 3.8 * mm

    # Whichever of logo and text runs lower sets where the body starts.
    y = min(y, logo_bottom) - 4 * mm

    doc.setStrokeColorRGB(0.8, 0.8, 0.8)
    doc.line(left, y, left + 170 * mm, y)

    return y - 8 * mm
