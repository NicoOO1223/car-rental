"""
What each renter email says, from plain values.

Pure: the values (names, amounts, times already formatted for the reader) come in,
the subject and paragraphs come out. Reading them from the database is
email_outbox.py's job; the settings screen's preview feeds the same builders with
made-up sample values, so what an administrator previews is what a renter gets.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.i18n.emails import Wording
from app.models import EmailTextOverride

TEMPLATES = ("booking_confirmed", "booking_cancelled", "receipt")

# Values for the preview on the settings screen. They look like real ones and are
# obviously not.
SAMPLES: dict[str, dict[str, str]] = {
    "booking_confirmed": {
        "name": "Giulia",
        "business": "Sample Rentals",
        "reference": "SAMPLE-1234",
        "vehicle": "Fiat Panda",
        "pickup_place": "Olbia Airport",
        "pickup_time": "2030-06-01 10:00 CEST",
        "return_place": "Olbia Airport",
        "return_time": "2030-06-04 10:00 CEST",
        "total": "135.00 EUR",
        "paid_online": "27.00 EUR",
        "contact": "info@example.com / +39 0789 000000",
    },
    "booking_cancelled": {
        "name": "Giulia",
        "business": "Sample Rentals",
        "reference": "SAMPLE-1234",
        "vehicle": "Fiat Panda",
        "when": "2030-06-01 10:00 CEST",
        "note": "refunded",
        "amount": "27.00 EUR",
        "contact": "info@example.com / +39 0789 000000",
    },
    "receipt": {
        "name": "Giulia",
        "business": "Sample Rentals",
        "number": "INV-000123",
        "amount": "108.00 EUR",
        "contact": "info@example.com / +39 0789 000000",
    },
}


def load_wording(db: Session) -> Wording:
    """The business's own lines (and the built-in ones for the rest)."""

    rows = db.execute(select(EmailTextOverride.key, EmailTextOverride.language, EmailTextOverride.text)).all()

    return Wording({(key, language): text for key, language, text in rows})


def _closing(wording: Wording, language: str, v: dict) -> list[str]:
    paragraphs = []

    if v.get("contact"):
        paragraphs.append(wording.line(language, "contact", contact=v["contact"]))

    paragraphs.append(wording.line(language, "signoff", business=v["business"]))

    return paragraphs


def build_booking_confirmed(wording: Wording, language: str, v: dict) -> tuple[str, list[str]]:
    line = wording.line

    details = [
        line(language, "confirmed.reference", reference=v["reference"]),
        line(language, "confirmed.vehicle", vehicle=v["vehicle"]),
        line(language, "confirmed.pickup", place=v["pickup_place"], when=v["pickup_time"]),
        line(language, "confirmed.return", place=v["return_place"], when=v["return_time"]),
        line(language, "confirmed.total", total=v["total"]),
    ]

    if v.get("paid_online"):
        details.append(line(language, "confirmed.paid_online", paid=v["paid_online"]))

    subject = line(language, "confirmed.subject", reference=v["reference"], business=v["business"])
    paragraphs = [
        line(language, "greeting", name=v["name"]),
        line(language, "confirmed.intro"),
        "\n".join(details),
        line(language, "confirmed.bring"),
        *_closing(wording, language, v),
    ]

    return subject, paragraphs


def build_booking_cancelled(wording: Wording, language: str, v: dict) -> tuple[str, list[str]]:
    """`v["note"]` is what happened to the online payment: "refunded", "kept", or
    empty for nothing to say."""

    line = wording.line

    subject = line(language, "cancelled.subject", reference=v["reference"], business=v["business"])
    paragraphs = [
        line(language, "greeting", name=v["name"]),
        line(language, "cancelled.intro", reference=v["reference"], vehicle=v["vehicle"], when=v["when"]),
    ]

    if v.get("amount") and v.get("note") in ("refunded", "kept"):
        paragraphs.append(line(language, f"cancelled.{v['note']}", amount=v["amount"]))

    paragraphs.extend(_closing(wording, language, v))

    return subject, paragraphs


def build_receipt(wording: Wording, language: str, v: dict) -> tuple[str, list[str]]:
    line = wording.line

    subject = line(language, "receipt.subject", number=v["number"], business=v["business"])
    paragraphs = [
        line(language, "greeting", name=v["name"]),
        line(language, "receipt.intro", amount=v["amount"]),
        line(language, "receipt.invoice", number=v["number"]),
        *_closing(wording, language, v),
    ]

    return subject, paragraphs


BUILDERS = {
    "booking_confirmed": build_booking_confirmed,
    "booking_cancelled": build_booking_cancelled,
    "receipt": build_receipt,
}
