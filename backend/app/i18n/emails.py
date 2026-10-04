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
    },
}


def line(language: str, key: str, **values) -> str:
    """One line in `language` (English if that language lacks it), filled in."""

    catalog = TEXT[document_language(language)]
    text = catalog.get(key) or TEXT[DEFAULT_DOCUMENT_LANGUAGE][key]

    return text.format(**values)


def compose(paragraphs: list[str]) -> tuple[str, str]:
    """The plain-text and HTML bodies of an email from its paragraphs. A
    paragraph may hold several lines (details listed one under the other)."""

    text = "\n\n".join(paragraphs)
    html = "".join(f"<p>{escape(paragraph).replace(chr(10), '<br>')}</p>" for paragraph in paragraphs)

    return text, f"<!doctype html><html><body>{html}</body></html>"
