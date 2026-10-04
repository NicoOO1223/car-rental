"""
The words of the emails sent to renters, in each supported language.

Kept apart from the interface catalogs and from the printed documents'
(app/i18n/documents.py) like the latter: an email is written in the business's
document language (Configuration), the same one its invoices and agreements use.
The Italian and Polish wording is a draft that a native speaker should read
before it is relied on, as with the documents.

An email is plain text and a small, plain HTML version of the same lines (no
images, no styling beyond paragraphs), which every mail program shows the same.
"""

import re
import string
from html import escape

from app.i18n.documents import DEFAULT_DOCUMENT_LANGUAGE, document_language

# Every template's lines. {placeholders} are filled when the email is written;
# a line whose placeholder is missing is not used (see compose()).
TEXT: dict[str, dict[str, str]] = {
    "en": {
        "greeting": "Hello {name},",
        "signoff": "Kind regards,\n{business}",
        "contact": "Questions? Reach us at {contact}.",
        "confirmed.subject": "Your booking {reference} is confirmed - {business}",
        "confirmed.intro": "Your booking is confirmed. Here are the details.",
        "confirmed.reference": "Booking number: {reference}",
        "confirmed.vehicle": "Vehicle: {vehicle}",
        "confirmed.pickup": "Pick-up: {place}, {when}",
        "confirmed.return": "Return: {place}, {when}",
        "confirmed.total": "Total: {total}",
        "confirmed.paid_online": "Paid online: {paid}",
        "confirmed.bring": "Please bring your driving licence and an identity document.",
        "cancelled.subject": "Your booking {reference} was cancelled - {business}",
        "cancelled.intro": "Your booking {reference} for {vehicle} ({when}) has been cancelled.",
        "cancelled.refunded": "The {amount} you paid online will be refunded to your card. It can take a few days to appear.",
        "cancelled.kept": "The {amount} you paid online is not refunded, as the cancellation conditions say.",
        "receipt.subject": "Receipt {number} - {business}",
        "receipt.intro": "Thank you. We have received your payment of {amount}.",
        "receipt.invoice": "Your invoice {number} is attached to this email.",
        "test.subject": "Test email from {business}",
        "test.body": "This is a test email from {business}. If you are reading it, sending works.",
    },
    "it": {
        "greeting": "Buongiorno {name},",
        "signoff": "Cordiali saluti,\n{business}",
        "contact": "Domande? Scrivici a {contact}.",
        "confirmed.subject": "La tua prenotazione {reference} è confermata - {business}",
        "confirmed.intro": "La tua prenotazione è confermata. Ecco i dettagli.",
        "confirmed.reference": "Numero di prenotazione: {reference}",
        "confirmed.vehicle": "Veicolo: {vehicle}",
        "confirmed.pickup": "Ritiro: {place}, {when}",
        "confirmed.return": "Riconsegna: {place}, {when}",
        "confirmed.total": "Totale: {total}",
        "confirmed.paid_online": "Pagato online: {paid}",
        "confirmed.bring": "Porta con te la patente di guida e un documento d'identità.",
        "cancelled.subject": "La tua prenotazione {reference} è stata annullata - {business}",
        "cancelled.intro": "La tua prenotazione {reference} per {vehicle} ({when}) è stata annullata.",
        "cancelled.refunded": "I {amount} pagati online ti saranno rimborsati sulla carta. Possono servire alcuni giorni perché compaiano.",
        "cancelled.kept": "I {amount} pagati online non vengono rimborsati, come previsto dalle condizioni di cancellazione.",
        "receipt.subject": "Ricevuta {number} - {business}",
        "receipt.intro": "Grazie. Abbiamo ricevuto il tuo pagamento di {amount}.",
        "receipt.invoice": "La tua fattura {number} è allegata a questa email.",
        "test.subject": "Email di prova da {business}",
        "test.body": "Questa è un'email di prova da {business}. Se la stai leggendo, l'invio funziona.",
    },
    "pl": {
        "greeting": "Dzień dobry {name},",
        "signoff": "Z poważaniem,\n{business}",
        "contact": "Pytania? Napisz do nas: {contact}.",
        "confirmed.subject": "Twoja rezerwacja {reference} jest potwierdzona - {business}",
        "confirmed.intro": "Twoja rezerwacja jest potwierdzona. Oto szczegóły.",
        "confirmed.reference": "Numer rezerwacji: {reference}",
        "confirmed.vehicle": "Pojazd: {vehicle}",
        "confirmed.pickup": "Odbiór: {place}, {when}",
        "confirmed.return": "Zwrot: {place}, {when}",
        "confirmed.total": "Razem: {total}",
        "confirmed.paid_online": "Zapłacono online: {paid}",
        "confirmed.bring": "Zabierz ze sobą prawo jazdy i dokument tożsamości.",
        "cancelled.subject": "Twoja rezerwacja {reference} została anulowana - {business}",
        "cancelled.intro": "Twoja rezerwacja {reference} na {vehicle} ({when}) została anulowana.",
        "cancelled.refunded": "Kwota {amount} zapłacona online zostanie zwrócona na Twoją kartę. Zwrot może być widoczny po kilku dniach.",
        "cancelled.kept": "Kwota {amount} zapłacona online nie podlega zwrotowi, zgodnie z warunkami anulowania.",
        "receipt.subject": "Potwierdzenie płatności {number} - {business}",
        "receipt.intro": "Dziękujemy. Otrzymaliśmy Twoją płatność w wysokości {amount}.",
        "receipt.invoice": "Faktura {number} jest w załączniku do tej wiadomości.",
        "test.subject": "Wiadomość testowa od {business}",
        "test.body": "To jest wiadomość testowa od {business}. Jeśli ją czytasz, wysyłanie działa.",
    },
}


def line(language: str, key: str, **values) -> str:
    """One built-in line in `language` (English if that language lacks it), filled in."""

    catalog = TEXT[document_language(language)]
    text = catalog.get(key) or TEXT[DEFAULT_DOCUMENT_LANGUAGE][key]

    return text.format(**values)


# The lines of each email, in the order they appear, for the settings screen. The
# lines every email shares (greeting, contact, sign-off) are one group: changing one
# changes it in all three.
GROUPS: dict[str, tuple[str, ...]] = {
    "shared": ("greeting", "contact", "signoff"),
    "booking_confirmed": (
        "confirmed.subject",
        "confirmed.intro",
        "confirmed.reference",
        "confirmed.vehicle",
        "confirmed.pickup",
        "confirmed.return",
        "confirmed.total",
        "confirmed.paid_online",
        "confirmed.bring",
    ),
    "booking_cancelled": ("cancelled.subject", "cancelled.intro", "cancelled.refunded", "cancelled.kept"),
    "receipt": ("receipt.subject", "receipt.intro", "receipt.invoice"),
}

MAX_TEXT_LENGTH = 2000


def is_subject(key: str) -> bool:
    return key.endswith(".subject")


def placeholders_of(key: str) -> tuple[str, ...]:
    """The {names} a line may use: the ones its built-in wording uses. The same in
    every language (a test checks it)."""

    return tuple(sorted(set(re.findall(r"\{(\w+)\}", TEXT[DEFAULT_DOCUMENT_LANGUAGE][key]))))


class WordingError(ValueError):
    """A line a business wrote cannot be used. `code` is a stable name for the
    settings screen to word in the reader's language."""

    def __init__(self, code: str, message: str, **params):
        super().__init__(message)
        self.code = code
        self.params = params


def check_text(key: str, text: str) -> str:
    """Whether `text` is a valid wording for the line `key`, returning it tidied.
    Only that line's own {names} are allowed, each plain (no {name.attribute},
    {name[0]} or format tricks), braces must pair up, and a subject is one line.
    Without this a typo would break every email of that kind at send time."""

    if key not in TEXT[DEFAULT_DOCUMENT_LANGUAGE]:
        raise WordingError("unknown_line", "There is no such line.")

    text = text.replace("\r\n", "\n").strip()

    if len(text) > MAX_TEXT_LENGTH:
        raise WordingError("too_long", "This is too long.", max=MAX_TEXT_LENGTH)

    if is_subject(key):
        if not text:
            raise WordingError("subject_empty", "The subject cannot be empty.")

        if "\n" in text:
            raise WordingError("subject_one_line", "The subject has to be a single line.")

    allowed = set(placeholders_of(key))

    try:
        parsed = list(string.Formatter().parse(text))
    except ValueError:
        raise WordingError(
            "braces",
            "A curly bracket is not paired. Write a value's name in curly brackets, for example {example}.",
            example="{name}",
        )

    for _, field, spec, conversion in parsed:
        if field is None:
            continue

        if field not in allowed or spec or conversion:
            raise WordingError(
                "unknown_placeholder",
                "{name} cannot be used in this line. You can use: {allowed}",
                name="{" + field + "}",
                allowed=", ".join("{" + name + "}" for name in sorted(allowed)) or "-",
            )

    return text


class Wording:
    """The lines of the emails: the business's own where it has written one, the
    built-in wording otherwise. Built once per email from the stored overrides."""

    def __init__(self, overrides: dict[tuple[str, str], str] | None = None):
        self._overrides = overrides or {}

    def line(self, language: str, key: str, **values) -> str:
        """The line in `language`, filled in. An override that is empty means the
        line is left out (an empty string comes back); an override that can no
        longer be filled in falls back to the built-in wording, so a bad stored
        line can never stop an email from being sent."""

        language = document_language(language)
        override = self._overrides.get((key, language))

        if override is not None and not (is_subject(key) and not override.strip()):
            try:
                return override.format(**values).strip()
            except (KeyError, IndexError, ValueError, AttributeError):
                pass

        return line(language, key, **values)


def compose(paragraphs: list[str]) -> tuple[str, str]:
    """The plain-text and HTML bodies of an email from its paragraphs. A paragraph
    may hold several lines (details listed one under the other); lines and
    paragraphs that came out empty are left out."""

    cleaned = []

    for paragraph in paragraphs:
        lines = [part for part in paragraph.split("\n") if part.strip()]

        if lines:
            cleaned.append("\n".join(lines))

    text = "\n\n".join(cleaned)
    html = "".join(f"<p>{escape(paragraph).replace(chr(10), '<br>')}</p>" for paragraph in cleaned)

    return text, f"<!doctype html><html><body>{html}</body></html>"
