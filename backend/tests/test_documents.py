"""
Printed documents in the business's document language: the catalogs agree,
the bundled font can print every letter in them, and an issued invoice keeps
the language it was issued in.
"""

import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfbase import pdfmetrics

from app.database import SessionLocal
from tests._dates import far_future_days
from app.i18n import documents
from app.i18n.documents import LABELS, document_language, format_amount, label
from app.languages import SUPPORTED_LANGUAGES
from app.main import app
from app.models import Handover, Invoice, Reservation
from app.services import pdf_common
from tests.test_handovers import create_confirmed_reservation

client = TestClient(app)

_PLACEHOLDER = re.compile(r"\{(\w+)\}")


# --- the catalogs ------------------------------------------------------------


def test_every_language_has_every_label_with_the_same_placeholders():
    english = LABELS["en"]

    for language in SUPPORTED_LANGUAGES:
        catalog = LABELS[language]

        assert set(catalog) == set(english), language

        for key, text in catalog.items():
            assert set(_PLACEHOLDER.findall(text)) == set(_PLACEHOLDER.findall(english[key])), (
                language,
                key,
            )
            assert text.strip(), (language, key)


def test_label_fills_placeholders_and_falls_back_to_english():
    assert label("it", "invoice.number", number="INV-000001") == "Numero: INV-000001"
    assert label("pl", "invoice.total") == "Razem"
    # An unknown language is English rather than an error.
    assert label("xx", "invoice.total") == "Total"
    assert document_language("xx") == "en"
    assert document_language(None) == "en"


def test_amounts_use_the_languages_own_separators():
    assert format_amount("1234.5", "eur", "en") == "1,234.50 EUR"
    assert format_amount("1234.5", "eur", "it") == "1.234,50 EUR"
    assert format_amount("1234.5", "eur", "pl") == "1 234,50 EUR"
    assert format_amount("-12", "eur", "it") == "-12,00 EUR"
    assert format_amount("0", "", "en") == "0.00"


# --- the font ----------------------------------------------------------------


def test_the_bundled_font_can_print_every_character_in_every_catalog():
    pdf_common.register_fonts()

    for font_name in (pdf_common.FONT, pdf_common.FONT_BOLD):
        supported = pdfmetrics.getFont(font_name).face.charToGlyph

        for language, catalog in LABELS.items():
            for key, text in catalog.items():
                missing = {char for char in text if char != "\n" and ord(char) not in supported}

                assert not missing, (font_name, language, key, missing)

        # Letters of every alphabet the app supports, including the ones the
        # built-in Helvetica cannot print.
        for char in "ąćęłńóśźżĄĆĘŁŃÓŚŹŻàèéìòùÀÈÉÌÒÙ€ ":
            assert ord(char) in supported, (font_name, char)


# --- the documents -----------------------------------------------------------


@pytest.fixture
def document_language_setting():
    original = client.get("/api/configuration").json()

    def set_to(language):
        assert client.patch("/api/configuration", json={"document_language": language}).status_code == 200

    yield set_to

    client.patch("/api/configuration", json={"document_language": original["document_language"]})


def _reservation():
    pickup = datetime.now(timezone.utc) + timedelta(days=far_future_days())

    return create_confirmed_reservation(
        "SA-008-AA",
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (pickup + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


@pytest.mark.parametrize("language", SUPPORTED_LANGUAGES)
def test_the_agreement_renders_in_each_language(document_language_setting, language):
    from app.services.agreement_pdf import render_agreement_pdf

    document_language_setting(language)
    reservation = _reservation()

    db = SessionLocal()
    try:
        row = db.get(Reservation, UUID(reservation["id"]))
        client.get(f"/api/reservations/{reservation['id']}/handover")
        handover = db.query(Handover).filter(Handover.reservation_id == row.id).one()

        pdf = render_agreement_pdf(db, row, row.car, handover)
    finally:
        db.close()
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

    assert pdf.startswith(b"%PDF")
    # The bundled font is embedded (the built-in Helvetica cannot print Polish).
    assert b"DejaVuSans" in pdf


def test_an_issued_invoice_keeps_its_language_when_the_setting_changes(
    document_language_setting, monkeypatch
):
    from app.services import invoice_pdf

    document_language_setting("it")
    reservation = _reservation()

    try:
        assert client.post(
            f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
        ).status_code == 200

        invoices = client.get(f"/api/reservations/{reservation['id']}/invoices").json()
        assert len(invoices) == 1
        invoice_id = UUID(invoices[0]["id"])

        # The business now prints its documents in Polish.
        document_language_setting("pl")

        used = set()
        original_label = invoice_pdf.label

        def spy(language, key, **values):
            used.add(language)

            return original_label(language, key, **values)

        monkeypatch.setattr(invoice_pdf, "label", spy)

        db = SessionLocal()
        try:
            invoice = db.get(Invoice, invoice_id)

            assert invoice.language == "it"

            # Rental and fee lines were stored with a key, so they can be
            # worded in the language of the invoice.
            assert invoice.lines[0]["key"] == "line.rental"
            assert invoice.lines[0]["params"]["plate"] == "SA-008-AA"
            assert invoice.lines[0]["description"].startswith("Vehicle rental:")

            pdf = invoice_pdf.render_invoice_pdf(db, invoice)
        finally:
            db.close()

        assert pdf.startswith(b"%PDF")
        assert used == {"it"}

        # The API keeps serving the English description for other clients.
        assert client.get(f"/api/invoices/{invoice_id}/pdf").status_code == 200
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_credit_note_is_printed_in_the_language_of_its_invoice(document_language_setting):
    document_language_setting("pl")
    reservation = _reservation()

    try:
        assert client.post(
            f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
        ).status_code == 200

        document_language_setting("it")

        # Cancelling a paid rental refunds it, which issues the credit note.
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

        documents_issued = client.get(f"/api/reservations/{reservation['id']}/invoices").json()
        by_kind = {item["kind"]: item for item in documents_issued}

        db = SessionLocal()
        try:
            invoice = db.get(Invoice, UUID(by_kind["INVOICE"]["id"]))
            assert invoice.language == "pl"

            if "CREDIT_NOTE" in by_kind:
                note = db.get(Invoice, UUID(by_kind["CREDIT_NOTE"]["id"]))
                assert note.language == "pl"
        finally:
            db.close()
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_the_document_language_only_accepts_supported_codes():
    assert client.patch("/api/configuration", json={"document_language": "xx"}).status_code == 422


# --- the terms the customer reads before signing ---------------------------------------------


def _terms(reservation_id):
    return client.get(f"/api/reservations/{reservation_id}/handover/agreement-terms")


def test_the_customer_sees_the_placeholder_terms_in_the_document_language(document_language_setting):
    original = client.get("/api/configuration").json()["agreement_terms"]
    client.patch("/api/configuration", json={"agreement_terms": ""})
    document_language_setting("it")
    reservation = _reservation()

    try:
        body = _terms(reservation["id"]).json()

        assert body["language"] == "it"
        assert body["is_placeholder"] is True
        assert body["title"] == "Termini e condizioni"
        assert body["terms"].strip()
    finally:
        client.patch("/api/configuration", json={"agreement_terms": original})
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_the_customer_sees_exactly_the_businesss_own_terms_and_the_pdf_prints_the_same():
    from app.services.agreement_pdf import agreement_terms

    original = client.get("/api/configuration").json()["agreement_terms"]
    own = "Clause one.\nClause two: no smoking."
    client.patch("/api/configuration", json={"agreement_terms": own})
    reservation = _reservation()

    try:
        body = _terms(reservation["id"]).json()

        assert body["terms"] == own
        assert body["is_placeholder"] is False

        db = SessionLocal()
        try:
            assert agreement_terms(db)["terms"] == body["terms"]
        finally:
            db.close()

        # Reading the terms does not start a handover.
        db = SessionLocal()
        try:
            assert db.query(Handover).filter(Handover.reservation_id == UUID(reservation["id"])).count() == 0
        finally:
            db.close()
    finally:
        client.patch("/api/configuration", json={"agreement_terms": original})
        client.patch(f"/api/reservations/{reservation['id']}/cancel")
