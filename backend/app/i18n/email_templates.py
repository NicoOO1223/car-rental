"""
The built-in wording of every email, in each supported language.

An email is one message per language: a subject and a body written as ordinary
text. {name} marks where a value goes. The optional bits that only appear when
they apply (what was paid online, the cancellation deadline, the link to manage a
booking) are *parts*, written once and dropped into messages as a value, like
{paid_online_note}. A line that contains a value that turns out to be empty is left
out, so an optional line disappears cleanly instead of leaving "Paid online: ".

An administrator can replace any message or part from Configuration > Email; what
is here is used for everything they have not changed. The Italian and Polish wording
is a draft that a native speaker should read, as with the printed documents.
"""

# --- messages: TEMPLATES[type][language] = (subject, body) -----------------------------------

TEMPLATES: dict[str, dict[str, tuple[str, str]]] = {
    "booking_confirmed": {
        "en": (
            "Your booking {reference} is confirmed - {business}",
            "Hello {name},\n\n"
            "Your booking is confirmed. Here are the details.\n\n"
            "Booking number: {reference}\n"
            "Vehicle: {vehicle}\n"
            "Pick-up: {pickup_place}, {pickup_time}\n"
            "Return: {return_place}, {return_time}\n"
            "Total: {total}\n"
            "{paid_online_note}\n\n"
            "{cancellation_policy}\n"
            "{bring_list}\n\n"
            "{manage_link}\n\n"
            "{signoff}",
        ),
        "it": (
            "La tua prenotazione {reference} è confermata - {business}",
            "Buongiorno {name},\n\n"
            "La tua prenotazione è confermata. Ecco i dettagli.\n\n"
            "Numero di prenotazione: {reference}\n"
            "Veicolo: {vehicle}\n"
            "Ritiro: {pickup_place}, {pickup_time}\n"
            "Riconsegna: {return_place}, {return_time}\n"
            "Totale: {total}\n"
            "{paid_online_note}\n\n"
            "{cancellation_policy}\n"
            "{bring_list}\n\n"
            "{manage_link}\n\n"
            "{signoff}",
        ),
        "pl": (
            "Twoja rezerwacja {reference} jest potwierdzona - {business}",
            "Dzień dobry {name},\n\n"
            "Twoja rezerwacja jest potwierdzona. Oto szczegóły.\n\n"
            "Numer rezerwacji: {reference}\n"
            "Pojazd: {vehicle}\n"
            "Odbiór: {pickup_place}, {pickup_time}\n"
            "Zwrot: {return_place}, {return_time}\n"
            "Razem: {total}\n"
            "{paid_online_note}\n\n"
            "{cancellation_policy}\n"
            "{bring_list}\n\n"
            "{manage_link}\n\n"
            "{signoff}",
        ),
    },
    "booking_cancelled": {
        "en": (
            "Your booking {reference} was cancelled - {business}",
            "Hello {name},\n\n"
            "Your booking {reference} for {vehicle} ({pickup_time}) has been cancelled.\n\n"
            "{payment_note}\n\n"
            "{signoff}",
        ),
        "it": (
            "La tua prenotazione {reference} è stata annullata - {business}",
            "Buongiorno {name},\n\n"
            "La tua prenotazione {reference} per {vehicle} ({pickup_time}) è stata annullata.\n\n"
            "{payment_note}\n\n"
            "{signoff}",
        ),
        "pl": (
            "Twoja rezerwacja {reference} została anulowana - {business}",
            "Dzień dobry {name},\n\n"
            "Twoja rezerwacja {reference} na {vehicle} ({pickup_time}) została anulowana.\n\n"
            "{payment_note}\n\n"
            "{signoff}",
        ),
    },
    "receipt": {
        "en": (
            "Receipt {number} - {business}",
            "Hello {name},\n\n"
            "Thank you. We have received your payment of {amount}.\n\n"
            "Your invoice {attached_invoice} is attached to this email.\n\n"
            "{manage_link}\n\n"
            "{signoff}",
        ),
        "it": (
            "Ricevuta {number} - {business}",
            "Buongiorno {name},\n\n"
            "Grazie. Abbiamo ricevuto il tuo pagamento di {amount}.\n\n"
            "La tua fattura {attached_invoice} è allegata a questa email.\n\n"
            "{manage_link}\n\n"
            "{signoff}",
        ),
        "pl": (
            "Potwierdzenie płatności {number} - {business}",
            "Dzień dobry {name},\n\n"
            "Dziękujemy. Otrzymaliśmy Twoją płatność w wysokości {amount}.\n\n"
            "Faktura {attached_invoice} jest w załączniku do tej wiadomości.\n\n"
            "{manage_link}\n\n"
            "{signoff}",
        ),
    },
}

# --- parts: PARTS[storage key][language] ----------------------------------------------------
# A part with variants is stored as "<part>.<variant>", e.g. "payment_note.refunded".

PARTS: dict[str, dict[str, str]] = {
    "signoff": {
        "en": "Kind regards,\n{business}\n{contact}",
        "it": "Cordiali saluti,\n{business}\n{contact}",
        "pl": "Z poważaniem,\n{business}\n{contact}",
    },
    "paid_online_note": {
        "en": "Paid online: {paid_online}",
        "it": "Pagato online: {paid_online}",
        "pl": "Zapłacono online: {paid_online}",
    },
    "cancellation_policy": {
        "en": "You can cancel free of charge until {cancellation_deadline}.",
        "it": "Puoi annullare gratuitamente fino al {cancellation_deadline}.",
        "pl": "Możesz anulować bezpłatnie do {cancellation_deadline}.",
    },
    "bring_list": {
        "en": "Please bring your driving licence and an identity document.",
        "it": "Porta con te la patente di guida e un documento d'identità.",
        "pl": "Zabierz ze sobą prawo jazdy i dokument tożsamości.",
    },
    "manage_link": {
        "en": "View or manage your booking: {manage_url}",
        "it": "Consulta o gestisci la tua prenotazione: {manage_url}",
        "pl": "Zobacz lub zarządzaj swoją rezerwacją: {manage_url}",
    },
    "payment_note.refunded": {
        "en": "The {amount} you paid online will be refunded to your card. It can take a few days to appear.",
        "it": "I {amount} pagati online ti saranno rimborsati sulla carta. Possono servire alcuni giorni perché compaiano.",
        "pl": "Kwota {amount} zapłacona online zostanie zwrócona na Twoją kartę. Zwrot może być widoczny po kilku dniach.",
    },
    "payment_note.kept": {
        "en": "The {amount} you paid online is not refunded, as the cancellation conditions say.",
        "it": "I {amount} pagati online non vengono rimborsati, come previsto dalle condizioni di cancellazione.",
        "pl": "Kwota {amount} zapłacona online nie podlega zwrotowi, zgodnie z warunkami anulowania.",
    },
}

# --- the automatic footer (not editable: the business's identity, from Business) -----------

FOOTER: dict[str, dict[str, str]] = {
    "vat": {"en": "VAT ID: {vat_id}", "it": "Partita IVA: {vat_id}", "pl": "NIP/VAT: {vat_id}"},
    "privacy": {"en": "Privacy notice: {url}", "it": "Informativa sulla privacy: {url}", "pl": "Informacja o prywatności: {url}"},
}

# --- the connection test (not editable: it only shows sending works) -----------------------

TEST: dict[str, tuple[str, str]] = {
    "en": ("Test email from {business}", "This is a test email from {business}. If you are reading it, sending works."),
    "it": ("Email di prova da {business}", "Questa è un'email di prova da {business}. Se la stai leggendo, l'invio funziona."),
    "pl": ("Wiadomość testowa od {business}", "To jest wiadomość testowa od {business}. Jeśli ją czytasz, wysyłanie działa."),
}
