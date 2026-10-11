"""
The words on printed documents (the rental agreement and invoices), in each
supported language.

Kept apart from the interface catalogs on purpose: the interface language is
each person's choice, but a document is written in the business's document
language (Configuration), and an issued invoice keeps the language it was
issued in. The wording of the agreement and of invoices can carry legal
weight in a country, so the Italian and Polish text here is a draft that a
native speaker should review before it is relied on.

Dates are printed the same way in every language ("2040-06-15 10:00 CEST"):
year first cannot be misread as day-first or month-first, and the zone is
named. Amounts use the language's own decimal and thousands separators.
"""

from decimal import Decimal

from app.languages import SUPPORTED_LANGUAGES

DEFAULT_DOCUMENT_LANGUAGE = "en"

LABELS: dict[str, dict[str, str]] = {
    "en": {
        "not_available": "N/A",
        "vat_id": "VAT ID: {vat_id}",
        # Agreement
        "agreement.title": "Vehicle Rental Agreement",
        "agreement.reservation_id": "Reservation ID: {id}",
        "agreement.customer": "Customer",
        "agreement.date_of_birth": "Date of birth: {date}",
        "agreement.address": "Address: {address}, {postal_code}",
        "agreement.identity_verified": "Identity verified via Stripe Identity on {date} ({document_type}, {country})",
        "agreement.vehicle": "Vehicle",
        "agreement.rental_period": "Rental Period",
        "agreement.pickup": "Pickup: {time} at {location}",
        "agreement.return": "Return: {time} at {location}",
        "agreement.payment": "Payment",
        "agreement.base_rental": "Base rental",
        "agreement.short_term_fee": "Short-term rental fee",
        "agreement.airport_change_fee": "Airport change fee",
        "agreement.price_adjustment": "Price adjustment",
        "agreement.total_paid": "Total paid",
        "agreement.paid_at": "Paid at: {time}",
        "agreement.paid_online": "Paid online when booking",
        "agreement.paid_at_counter": "Paid at the counter",
        "agreement.terms": "Terms & Conditions",
        "agreement.default_terms": (
            "The customer agrees to return the vehicle in the same condition as "
            "received, subject to normal wear and tear, at the agreed return "
            "location and time. The customer is responsible for all traffic "
            "violations, tolls, and fines incurred during the rental period.\n"
            "Fuel policy: same-to-same. Full payment has been collected in advance "
            "as recorded below."
        ),
        "agreement.customer_signature": "Customer Signature",
        "agreement.no_signature": "(no signature on file)",
        "agreement.approved_by": "Approved by (employee)",
        "agreement.employee": "Employee: {email}",
        "agreement.signed_at": "Signed at: {time}",
        "agreement.no_employee_signature": "(no employee signature on file)",
        # Invoice
        "invoice.title": "Invoice",
        "invoice.credit_note": "Credit note",
        "invoice.number": "Number: {number}",
        "invoice.date": "Date: {date}",
        "invoice.credits_invoice": "Credits invoice: {number}",
        "invoice.booking_reference": "Booking reference: {reference}",
        "invoice.billed_to": "Billed to",
        "invoice.description": "Description",
        "invoice.quantity": "Qty",
        "invoice.unit_price": "Unit price",
        "invoice.amount": "Amount",
        "invoice.total_vat_included": "Total (VAT included)",
        "invoice.of_which_vat": "of which VAT {rate}%",
        "invoice.net_amount": "Net amount",
        "invoice.subtotal": "Subtotal",
        "invoice.vat": "VAT {rate}%",
        "invoice.total": "Total",
        # Invoice lines that carry a key
        "line.rental": "Vehicle rental: {make} {model} ({plate})",
        "line.short_term_fee": "Short-term rental fee",
        "line.one_way_fee": "One-way rental fee",
        "line.adjustment": "Price adjustment: {reason}",
        "line.advance": "Advance payment for booking {reference}",
        "line.advance_deducted": "Advance payment received (invoice {number})",
    },
    "it": {
        "not_available": "N/D",
        "vat_id": "P. IVA: {vat_id}",
        "agreement.title": "Contratto di noleggio veicolo",
        "agreement.reservation_id": "ID prenotazione: {id}",
        "agreement.customer": "Cliente",
        "agreement.date_of_birth": "Data di nascita: {date}",
        "agreement.address": "Indirizzo: {address}, {postal_code}",
        "agreement.identity_verified": "Identità verificata tramite Stripe Identity il {date} ({document_type}, {country})",
        "agreement.vehicle": "Veicolo",
        "agreement.rental_period": "Periodo di noleggio",
        "agreement.pickup": "Ritiro: {time} presso {location}",
        "agreement.return": "Riconsegna: {time} presso {location}",
        "agreement.payment": "Pagamento",
        "agreement.base_rental": "Noleggio base",
        "agreement.short_term_fee": "Supplemento per noleggio breve",
        "agreement.airport_change_fee": "Supplemento per cambio aeroporto",
        "agreement.price_adjustment": "Modifica del prezzo",
        "agreement.total_paid": "Totale pagato",
        "agreement.paid_at": "Pagato il: {time}",
        "agreement.paid_online": "Pagato online alla prenotazione",
        "agreement.paid_at_counter": "Pagato al banco",
        "agreement.terms": "Termini e condizioni",
        "agreement.default_terms": (
            "Il cliente si impegna a restituire il veicolo nelle stesse condizioni in cui "
            "lo ha ricevuto, salvo la normale usura, presso la sede e all’orario di "
            "riconsegna concordati. Il cliente è responsabile di tutte le infrazioni "
            "stradali, i pedaggi e le multe maturati durante il periodo di noleggio.\n"
            "Politica del carburante: pieno/pieno. Il pagamento integrale è stato "
            "incassato in anticipo come indicato di seguito."
        ),
        "agreement.customer_signature": "Firma del cliente",
        "agreement.no_signature": "(nessuna firma agli atti)",
        "agreement.approved_by": "Approvato da (dipendente)",
        "agreement.employee": "Dipendente: {email}",
        "agreement.signed_at": "Firmato il: {time}",
        "agreement.no_employee_signature": "(nessuna firma del dipendente agli atti)",
        "invoice.title": "Fattura",
        "invoice.credit_note": "Nota di credito",
        "invoice.number": "Numero: {number}",
        "invoice.date": "Data: {date}",
        "invoice.credits_invoice": "Storna la fattura: {number}",
        "invoice.booking_reference": "Riferimento prenotazione: {reference}",
        "invoice.billed_to": "Intestata a",
        "invoice.description": "Descrizione",
        "invoice.quantity": "Q.tà",
        "invoice.unit_price": "Prezzo unitario",
        "invoice.amount": "Importo",
        "invoice.total_vat_included": "Totale (IVA inclusa)",
        "invoice.of_which_vat": "di cui IVA {rate}%",
        "invoice.net_amount": "Imponibile",
        "invoice.subtotal": "Imponibile",
        "invoice.vat": "IVA {rate}%",
        "invoice.total": "Totale",
        "line.rental": "Noleggio veicolo: {make} {model} ({plate})",
        "line.short_term_fee": "Supplemento per noleggio breve",
        "line.one_way_fee": "Supplemento per noleggio di sola andata",
        "line.adjustment": "Modifica del prezzo: {reason}",
        "line.advance": "Acconto sulla prenotazione {reference}",
        "line.advance_deducted": "Acconto ricevuto (fattura {number})",
    },
    "pl": {
        "not_available": "brak danych",
        "vat_id": "NIP / VAT: {vat_id}",
        "agreement.title": "Umowa najmu pojazdu",
        "agreement.reservation_id": "Numer rezerwacji: {id}",
        "agreement.customer": "Klient",
        "agreement.date_of_birth": "Data urodzenia: {date}",
        "agreement.address": "Adres: {address}, {postal_code}",
        "agreement.identity_verified": "Tożsamość zweryfikowana przez Stripe Identity dnia {date} ({document_type}, {country})",
        "agreement.vehicle": "Pojazd",
        "agreement.rental_period": "Okres najmu",
        "agreement.pickup": "Wydanie: {time}, {location}",
        "agreement.return": "Zwrot: {time}, {location}",
        "agreement.payment": "Płatność",
        "agreement.base_rental": "Wynajem podstawowy",
        "agreement.short_term_fee": "Opłata za krótki wynajem",
        "agreement.airport_change_fee": "Opłata za zmianę lotniska",
        "agreement.price_adjustment": "Korekta ceny",
        "agreement.total_paid": "Zapłacono łącznie",
        "agreement.paid_at": "Data płatności: {time}",
        "agreement.paid_online": "Zapłacono online przy rezerwacji",
        "agreement.paid_at_counter": "Zapłacono na miejscu",
        "agreement.terms": "Warunki i zasady",
        "agreement.default_terms": (
            "Klient zobowiązuje się zwrócić pojazd w takim samym stanie, w jakim go "
            "otrzymał, z uwzględnieniem normalnego zużycia, w uzgodnionym miejscu i "
            "czasie zwrotu. Klient odpowiada za wszystkie wykroczenia drogowe, opłaty "
            "drogowe i mandaty powstałe w okresie najmu.\n"
            "Zasada paliwowa: pełny zbiornik na pełny zbiornik. Pełna płatność została "
            "pobrana z góry, jak wskazano poniżej."
        ),
        "agreement.customer_signature": "Podpis klienta",
        "agreement.no_signature": "(brak podpisu w aktach)",
        "agreement.approved_by": "Zatwierdzone przez (pracownik)",
        "agreement.employee": "Pracownik: {email}",
        "agreement.signed_at": "Podpisano: {time}",
        "agreement.no_employee_signature": "(brak podpisu pracownika w aktach)",
        "invoice.title": "Faktura",
        "invoice.credit_note": "Nota korygująca",
        "invoice.number": "Numer: {number}",
        "invoice.date": "Data: {date}",
        "invoice.credits_invoice": "Koryguje fakturę: {number}",
        "invoice.booking_reference": "Numer rezerwacji: {reference}",
        "invoice.billed_to": "Nabywca",
        "invoice.description": "Opis",
        "invoice.quantity": "Ilość",
        "invoice.unit_price": "Cena jedn.",
        "invoice.amount": "Kwota",
        "invoice.total_vat_included": "Razem (z VAT)",
        "invoice.of_which_vat": "w tym VAT {rate}%",
        "invoice.net_amount": "Kwota netto",
        "invoice.subtotal": "Kwota netto",
        "invoice.vat": "VAT {rate}%",
        "invoice.total": "Razem",
        "line.rental": "Wynajem pojazdu: {make} {model} ({plate})",
        "line.short_term_fee": "Opłata za krótki wynajem",
        "line.one_way_fee": "Opłata za wynajem w jedną stronę",
        "line.adjustment": "Korekta ceny: {reason}",
        "line.advance": "Zaliczka na rezerwację {reference}",
        "line.advance_deducted": "Otrzymana zaliczka (faktura {number})",
    },
}

# Only the codes the app supports have a catalog.
assert set(LABELS) == set(SUPPORTED_LANGUAGES)


def document_language(value: str | None) -> str:
    """A stored language code, or English for anything unknown."""

    return value if value in LABELS else DEFAULT_DOCUMENT_LANGUAGE


def label(language: str, key: str, **values) -> str:
    """The text for `key` in `language`, with {placeholders} filled in.
    A key missing from a language shows its English wording."""

    catalog = LABELS[document_language(language)]
    text = catalog.get(key) or LABELS[DEFAULT_DOCUMENT_LANGUAGE][key]

    return text.format(**values) if values else text


# Decimal and thousands separators per language.
_SEPARATORS = {"en": (".", ","), "it": (",", "."), "pl": (",", " ")}


def format_amount(value, currency: str, language: str) -> str:
    """"1,234.50 EUR" in English, "1.234,50 EUR" in Italian, "1 234,50 EUR"
    in Polish. The currency code is printed, never guessed from the language."""

    decimal_point, thousands = _SEPARATORS[document_language(language)]
    number = f"{Decimal(str(value)):,.2f}"
    # Swap through a placeholder so the two replacements cannot collide.
    number = number.replace(",", "\0").replace(".", decimal_point).replace("\0", thousands)

    return f"{number} {currency.upper()}".strip()
