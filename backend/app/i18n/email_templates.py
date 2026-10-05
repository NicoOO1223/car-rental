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

TEMPLATES.update(
    {
        "booking_changed": {
            "en": (
                "Your booking {reference} has changed - {business}",
                "Hello {name},\n\n"
                "Your booking {reference} has been changed. Here is what is different:\n\n"
                "{changes}\n\n"
                "Your booking now stands at:\n"
                "Vehicle: {vehicle}\n"
                "Pick-up: {pickup_place}, {pickup_time}\n"
                "Return: {return_place}, {return_time}\n\n"
                "If this is not what you agreed, please contact us.\n\n"
                "{manage_link}\n\n"
                "{signoff}",
            ),
            "it": (
                "La tua prenotazione {reference} è cambiata - {business}",
                "Buongiorno {name},\n\n"
                "La tua prenotazione {reference} è stata modificata. Ecco cosa è cambiato:\n\n"
                "{changes}\n\n"
                "Ora la prenotazione è:\n"
                "Veicolo: {vehicle}\n"
                "Ritiro: {pickup_place}, {pickup_time}\n"
                "Riconsegna: {return_place}, {return_time}\n\n"
                "Se non è quanto concordato, contattaci.\n\n"
                "{manage_link}\n\n"
                "{signoff}",
            ),
            "pl": (
                "Twoja rezerwacja {reference} została zmieniona - {business}",
                "Dzień dobry {name},\n\n"
                "Twoja rezerwacja {reference} została zmieniona. Oto co się zmieniło:\n\n"
                "{changes}\n\n"
                "Rezerwacja wygląda teraz tak:\n"
                "Pojazd: {vehicle}\n"
                "Odbiór: {pickup_place}, {pickup_time}\n"
                "Zwrot: {return_place}, {return_time}\n\n"
                "Jeśli to nie jest zgodne z ustaleniami, skontaktuj się z nami.\n\n"
                "{manage_link}\n\n"
                "{signoff}",
            ),
        },
        "pickup_reminder": {
            "en": (
                "Your pick-up is coming up: {reference} - {business}",
                "Hello {name},\n\n"
                "A reminder that you are picking up your {vehicle} soon.\n\n"
                "When: {pickup_time}\n"
                "Where: {pickup_place}\n"
                "Booking number: {reference}\n\n"
                "{bring_list}\n\n"
                "{manage_link}\n\n"
                "{signoff}",
            ),
            "it": (
                "Il ritiro si avvicina: {reference} - {business}",
                "Buongiorno {name},\n\n"
                "Ti ricordiamo che a breve ritirerai la tua {vehicle}.\n\n"
                "Quando: {pickup_time}\n"
                "Dove: {pickup_place}\n"
                "Numero di prenotazione: {reference}\n\n"
                "{bring_list}\n\n"
                "{manage_link}\n\n"
                "{signoff}",
            ),
            "pl": (
                "Zbliża się odbiór: {reference} - {business}",
                "Dzień dobry {name},\n\n"
                "Przypominamy, że wkrótce odbierasz samochód: {vehicle}.\n\n"
                "Kiedy: {pickup_time}\n"
                "Gdzie: {pickup_place}\n"
                "Numer rezerwacji: {reference}\n\n"
                "{bring_list}\n\n"
                "{manage_link}\n\n"
                "{signoff}",
            ),
        },
        "agreement_copy": {
            "en": (
                "Your rental agreement {reference} - {business}",
                "Hello {name},\n\n"
                "Enjoy your {vehicle}. Your signed rental agreement {attached_agreement} is attached for your records.\n\n"
                "Please return the car to {return_place} by {return_time}.\n\n"
                "{signoff}",
            ),
            "it": (
                "Il tuo contratto di noleggio {reference} - {business}",
                "Buongiorno {name},\n\n"
                "Buon viaggio con la tua {vehicle}. Il contratto di noleggio firmato {attached_agreement} è allegato per i tuoi archivi.\n\n"
                "Riconsegna l'auto a {return_place} entro {return_time}.\n\n"
                "{signoff}",
            ),
            "pl": (
                "Twoja umowa najmu {reference} - {business}",
                "Dzień dobry {name},\n\n"
                "Udanej jazdy: {vehicle}. Podpisana umowa najmu {attached_agreement} jest w załączniku do Twojej dokumentacji.\n\n"
                "Zwróć samochód w miejscu {return_place} do {return_time}.\n\n"
                "{signoff}",
            ),
        },
        "return_summary": {
            "en": (
                "Thank you for renting with {business} - {reference}",
                "Hello {name},\n\n"
                "Thank you for renting with us. Your return is complete.\n\n"
                "Booking number: {reference}\n"
                "Vehicle: {vehicle}\n"
                "Returned: {returned_at}\n"
                "Late return fee: {late_fee}\n"
                "Fuel fee: {fuel_fee}\n"
                "Damage charge: {damage_charge}\n"
                "Total charged at return: {total_charge}\n\n"
                "{deposit_note}\n\n"
                "{signoff}",
            ),
            "it": (
                "Grazie per aver noleggiato con {business} - {reference}",
                "Buongiorno {name},\n\n"
                "Grazie per aver noleggiato con noi. La riconsegna è completata.\n\n"
                "Numero di prenotazione: {reference}\n"
                "Veicolo: {vehicle}\n"
                "Riconsegnato: {returned_at}\n"
                "Penale per ritardo: {late_fee}\n"
                "Costo carburante: {fuel_fee}\n"
                "Danni: {damage_charge}\n"
                "Totale addebitato alla riconsegna: {total_charge}\n\n"
                "{deposit_note}\n\n"
                "{signoff}",
            ),
            "pl": (
                "Dziękujemy za wynajem w {business} - {reference}",
                "Dzień dobry {name},\n\n"
                "Dziękujemy za skorzystanie z naszych usług. Zwrot został zakończony.\n\n"
                "Numer rezerwacji: {reference}\n"
                "Pojazd: {vehicle}\n"
                "Zwrócono: {returned_at}\n"
                "Opłata za spóźnienie: {late_fee}\n"
                "Opłata za paliwo: {fuel_fee}\n"
                "Opłata za uszkodzenia: {damage_charge}\n"
                "Łącznie pobrano przy zwrocie: {total_charge}\n\n"
                "{deposit_note}\n\n"
                "{signoff}",
            ),
        },
        "refund_notice": {
            "en": (
                "Your refund of {amount} - {business}",
                "Hello {name},\n\n"
                "We have refunded {amount} for booking {reference} to your card. It can take a few days to appear.\n\n"
                "The credit note {attached_credit_note} is attached.\n\n"
                "{signoff}",
            ),
            "it": (
                "Il tuo rimborso di {amount} - {business}",
                "Buongiorno {name},\n\n"
                "Abbiamo rimborsato {amount} sulla tua carta per la prenotazione {reference}. Possono servire alcuni giorni perché compaia.\n\n"
                "La nota di credito {attached_credit_note} è allegata.\n\n"
                "{signoff}",
            ),
            "pl": (
                "Twój zwrot {amount} - {business}",
                "Dzień dobry {name},\n\n"
                "Zwróciliśmy {amount} na Twoją kartę za rezerwację {reference}. Zwrot może być widoczny po kilku dniach.\n\n"
                "Faktura korygująca {attached_credit_note} jest w załączniku.\n\n"
                "{signoff}",
            ),
        },
    }
)

TEMPLATES.update(
    {
        "new_online_booking": {
            "en": (
                "New online booking {reference}: {vehicle}",
                "A booking was just paid on the website.\n\n"
                "Booking number: {reference}\n"
                "Renter: {name} ({email})\n"
                "Vehicle: {vehicle}\n"
                "Pick-up: {pickup_place}, {pickup_time}\n"
                "Return: {return_time}\n"
                "Paid online: {paid_online}",
            ),
            "it": (
                "Nuova prenotazione online {reference}: {vehicle}",
                "Una prenotazione è stata appena pagata sul sito.\n\n"
                "Numero di prenotazione: {reference}\n"
                "Cliente: {name} ({email})\n"
                "Veicolo: {vehicle}\n"
                "Ritiro: {pickup_place}, {pickup_time}\n"
                "Riconsegna: {return_time}\n"
                "Pagato online: {paid_online}",
            ),
            "pl": (
                "Nowa rezerwacja online {reference}: {vehicle}",
                "Na stronie właśnie opłacono rezerwację.\n\n"
                "Numer rezerwacji: {reference}\n"
                "Klient: {name} ({email})\n"
                "Pojazd: {vehicle}\n"
                "Odbiór: {pickup_place}, {pickup_time}\n"
                "Zwrot: {return_time}\n"
                "Zapłacono online: {paid_online}",
            ),
        },
        "online_cancellation": {
            "en": (
                "Booking {reference} cancelled online",
                "A renter cancelled their booking on the website.\n\n"
                "Booking number: {reference}\n"
                "Renter: {name}\n"
                "Vehicle: {vehicle}\n"
                "Was to be picked up: {pickup_time}\n\n"
                "{payment_outcome}",
            ),
            "it": (
                "Prenotazione {reference} annullata online",
                "Un cliente ha annullato la prenotazione sul sito.\n\n"
                "Numero di prenotazione: {reference}\n"
                "Cliente: {name}\n"
                "Veicolo: {vehicle}\n"
                "Ritiro previsto: {pickup_time}\n\n"
                "{payment_outcome}",
            ),
            "pl": (
                "Rezerwacja {reference} anulowana online",
                "Klient anulował rezerwację na stronie.\n\n"
                "Numer rezerwacji: {reference}\n"
                "Klient: {name}\n"
                "Pojazd: {vehicle}\n"
                "Planowany odbiór: {pickup_time}\n\n"
                "{payment_outcome}",
            ),
        },
        "needs_attention": {
            "en": ("Needs attention: {what}", "{what}\n\n{details}"),
            "it": ("Richiede attenzione: {what}", "{what}\n\n{details}"),
            "pl": ("Wymaga uwagi: {what}", "{what}\n\n{details}"),
        },
    }
)

TEMPLATES.update(
    {
        "verify_email": {
            "en": (
                "Confirm your email - {business}",
                "Hello {name},\n\n"
                "Please confirm your email address to finish setting up your account:\n\n"
                "{link}\n\n"
                "The link works for {expires}. If you did not create an account, you can ignore this email.\n\n"
                "{signoff}",
            ),
            "it": (
                "Conferma la tua email - {business}",
                "Buongiorno {name},\n\n"
                "Conferma il tuo indirizzo email per completare la creazione dell'account:\n\n"
                "{link}\n\n"
                "Il link è valido per {expires}. Se non hai creato un account, puoi ignorare questa email.\n\n"
                "{signoff}",
            ),
            "pl": (
                "Potwierdź swój adres e-mail - {business}",
                "Dzień dobry {name},\n\n"
                "Potwierdź swój adres e-mail, aby dokończyć zakładanie konta:\n\n"
                "{link}\n\n"
                "Link działa przez {expires}. Jeśli nie zakładasz konta, zignoruj tę wiadomość.\n\n"
                "{signoff}",
            ),
        },
        "reset_password": {
            "en": (
                "Reset your password - {business}",
                "Hello {name},\n\n"
                "We received a request to reset the password of your account. Choose a new one here:\n\n"
                "{link}\n\n"
                "The link works once, for {expires}. If you did not ask for this, ignore this email: your password stays as it is.\n\n"
                "{signoff}",
            ),
            "it": (
                "Reimposta la tua password - {business}",
                "Buongiorno {name},\n\n"
                "Abbiamo ricevuto una richiesta di reimpostare la password del tuo account. Scegline una nuova qui:\n\n"
                "{link}\n\n"
                "Il link funziona una sola volta, per {expires}. Se non l'hai richiesto, ignora questa email: la password resta invariata.\n\n"
                "{signoff}",
            ),
            "pl": (
                "Zresetuj hasło - {business}",
                "Dzień dobry {name},\n\n"
                "Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta. Ustaw nowe tutaj:\n\n"
                "{link}\n\n"
                "Link działa jednorazowo, przez {expires}. Jeśli to nie Ty, zignoruj tę wiadomość: hasło pozostaje bez zmian.\n\n"
                "{signoff}",
            ),
        },
    }
)

# How long a link works, as the email says it: EXPIRES[kind][language].
EXPIRES: dict[str, dict[str, str]] = {
    "verify_email": {"en": "24 hours", "it": "24 ore", "pl": "24 godziny"},
    "reset_password": {"en": "1 hour", "it": "1 ora", "pl": "1 godzinę"},
}

# What the business is told in the "needs attention" email, and how an online
# cancellation ended for the money: ALERTS[kind][language], filled with {fields}.
ALERTS: dict[str, dict[str, str]] = {
    "late_payment_refunded.what": {
        "en": "A late online payment was refunded",
        "it": "Un pagamento online tardivo è stato rimborsato",
        "pl": "Spóźniona płatność online została zwrócona",
    },
    "late_payment_refunded.details": {
        "en": "Booking {reference} was paid after its hold ran out and the car had been taken, so {amount} was refunded automatically. The renter may need a word from you.",
        "it": "La prenotazione {reference} è stata pagata dopo la scadenza del blocco e l'auto era stata presa, quindi {amount} sono stati rimborsati automaticamente. Il cliente potrebbe aver bisogno di un tuo messaggio.",
        "pl": "Rezerwacja {reference} została opłacona po wygaśnięciu blokady, a samochód był już zajęty, więc {amount} zwrócono automatycznie. Klient może potrzebować od Ciebie wiadomości.",
    },
    "email_failed.what": {
        "en": "An email could not be delivered",
        "it": "Non è stato possibile consegnare un'email",
        "pl": "Nie udało się dostarczyć wiadomości",
    },
    "email_failed.details": {
        "en": "The {template} email to {to} failed {attempts} times and was given up on. Last error: {error}. You can send it again from Configuration > Email.",
        "it": "L'email {template} a {to} è fallita {attempts} volte e non verrà più inviata. Ultimo errore: {error}. Puoi inviarla di nuovo da Configurazione > Email.",
        "pl": "Wiadomość {template} do {to} nie została wysłana {attempts} razy i zaniechano dalszych prób. Ostatni błąd: {error}. Możesz wysłać ją ponownie w Konfiguracji > E-mail.",
    },
    "outcome.refunded": {
        "en": "The online payment of {amount} was refunded.",
        "it": "Il pagamento online di {amount} è stato rimborsato.",
        "pl": "Płatność online w wysokości {amount} została zwrócona.",
    },
    "outcome.kept": {
        "en": "The online payment of {amount} was kept (cancelled after the free-cancellation deadline).",
        "it": "Il pagamento online di {amount} è stato trattenuto (annullata dopo il termine di cancellazione gratuita).",
        "pl": "Płatność online w wysokości {amount} została zatrzymana (anulowanie po terminie darmowej rezygnacji).",
    },
}

# --- what changed, for the "booking changed" email: CHANGES[label][language] ---------------

CHANGES: dict[str, dict[str, str]] = {
    "vehicle": {"en": "Vehicle", "it": "Veicolo", "pl": "Pojazd"},
    "pickup_time": {"en": "Pick-up time", "it": "Orario di ritiro", "pl": "Czas odbioru"},
    "return_time": {"en": "Return time", "it": "Orario di riconsegna", "pl": "Czas zwrotu"},
    "pickup_place": {"en": "Pick-up place", "it": "Luogo di ritiro", "pl": "Miejsce odbioru"},
    "return_place": {"en": "Return place", "it": "Luogo di riconsegna", "pl": "Miejsce zwrotu"},
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
    "deposit_note.returned": {
        "en": "Your security deposit of {deposit_returned} has been released.",
        "it": "La tua cauzione di {deposit_returned} è stata rilasciata.",
        "pl": "Twoja kaucja w wysokości {deposit_returned} została zwolniona.",
    },
    "deposit_note.applied": {
        "en": "{deposit_applied} of your security deposit was used for the charges above. The remaining {deposit_returned} has been released.",
        "it": "{deposit_applied} della tua cauzione sono stati usati per gli addebiti sopra. I restanti {deposit_returned} sono stati rilasciati.",
        "pl": "Kwota {deposit_applied} Twojej kaucji została wykorzystana na powyższe opłaty. Pozostałe {deposit_returned} zostało zwolnione.",
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
