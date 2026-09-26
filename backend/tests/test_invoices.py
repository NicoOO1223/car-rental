import hashlib
import hmac
import json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import config
from app.database import SessionLocal
from tests._dates import far_future_days
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, Handover, Invoice
from app.services.invoices import issue_invoice_for_handover
from tests.conftest import _get_fake_user
from tests.test_handovers import create_confirmed_reservation

client = TestClient(app)


def _dates(days=2):
    pickup = datetime.now(timezone.utc) + timedelta(days=far_future_days())

    return (
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (pickup + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _reservation():
    pickup_at, return_at = _dates()

    return create_confirmed_reservation("SA-008-AA", pickup_at, return_at)


def _pay_cash(reservation):
    response = client.post(f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment")
    assert response.status_code == 200

    return response.json()


def _invoices(reservation_id):
    response = client.get(f"/api/reservations/{reservation_id}/invoices")
    assert response.status_code == 200

    return response.json()


def _cancel(reservation):
    return client.patch(f"/api/reservations/{reservation['id']}/cancel")


@pytest.fixture
def vat():
    original = client.get("/api/configuration").json()

    def set_to(rate, include=True, prefix=None):
        payload = {"vat_rate": rate, "prices_include_vat": include}
        if prefix is not None:
            payload["invoice_prefix"] = prefix
        assert client.patch("/api/configuration", json=payload).status_code == 200

    yield set_to

    client.patch(
        "/api/configuration",
        json={
            "vat_rate": original["vat_rate"],
            "prices_include_vat": original["prices_include_vat"],
            "invoice_prefix": original["invoice_prefix"],
            "business_name": original["business_name"],
            "vat_id": original["vat_id"],
        },
    )


# --- issuing ------------------------------------------------------------------


def test_a_cash_payment_issues_a_numbered_invoice(vat):
    vat(22, True, prefix="tst")
    reservation = _reservation()

    try:
        handover = _pay_cash(reservation)
        invoices = _invoices(reservation["id"])

        assert len(invoices) == 1
        invoice = invoices[0]

        assert invoice["kind"] == "INVOICE"
        assert invoice["number"].startswith("TST-")
        assert len(invoice["number"]) == len("TST-000000")
        assert invoice["total_amount"] == handover["payment_amount"]
        assert invoice["vat_rate"] == 22
        assert invoice["prices_include_vat"] is True
        assert round(invoice["net_amount"] + invoice["vat_amount"], 2) == invoice["total_amount"]
        assert invoice["vat_amount"] == round(invoice["total_amount"] * 22 / 122, 2)
    finally:
        _cancel(reservation)


def test_paying_again_does_not_issue_a_second_invoice(vat):
    vat(0)
    reservation = _reservation()

    try:
        _pay_cash(reservation)
        _pay_cash(reservation)

        assert len(_invoices(reservation["id"])) == 1
    finally:
        _cancel(reservation)


def test_a_reservation_that_was_never_paid_has_no_invoice():
    reservation = _reservation()

    try:
        assert _invoices(reservation["id"]) == []
    finally:
        _cancel(reservation)


def test_issuing_is_audited(vat):
    vat(0)
    reservation = _reservation()

    try:
        _pay_cash(reservation)
        invoice = _invoices(reservation["id"])[0]

        db = SessionLocal()
        entry = db.scalar(
            select(AuditLog).where(
                AuditLog.entity_id == UUID(invoice["id"]), AuditLog.action == "invoice.issued"
            )
        )
        db.close()

        assert entry is not None
        assert entry.details["number"] == invoice["number"]
    finally:
        _cancel(reservation)


def test_vat_exclusive_pricing_bills_the_gross_amount(vat):
    vat(22, False)
    reservation = _reservation()

    try:
        handover = _pay_cash(reservation)
        invoice = _invoices(reservation["id"])[0]

        # What was collected already contains the VAT that was added on top.
        assert invoice["prices_include_vat"] is False
        assert invoice["total_amount"] == handover["payment_amount"]
        assert round(invoice["net_amount"] + invoice["vat_amount"], 2) == invoice["total_amount"]
        assert invoice["vat_amount"] == round(invoice["total_amount"] * 22 / 122, 2)
    finally:
        _cancel(reservation)


# --- an issued invoice never changes ---------------------------------------------


def test_an_invoice_keeps_the_details_it_was_issued_with(vat):
    vat(22, True)
    client.patch("/api/configuration", json={"business_name": "Original Cars", "vat_id": "IT111"})
    reservation = _reservation()

    try:
        _pay_cash(reservation)
        invoice = _invoices(reservation["id"])[0]

        db = SessionLocal()
        stored = db.get(Invoice, UUID(invoice["id"]))
        before = (dict(stored.seller), dict(stored.customer), list(stored.lines))
        db.close()

        # The business and its VAT change afterwards.
        client.patch(
            "/api/configuration",
            json={"business_name": "Renamed Cars", "vat_id": "IT222", "vat_rate": 5},
        )

        after = _invoices(reservation["id"])[0]
        assert after == invoice

        db = SessionLocal()
        stored = db.get(Invoice, UUID(invoice["id"]))
        assert (dict(stored.seller), dict(stored.customer), list(stored.lines)) == before
        assert stored.seller["business_name"] == "Original Cars"
        assert stored.seller["vat_id"] == "IT111"
        assert stored.vat_rate == 22
        db.close()
    finally:
        _cancel(reservation)


def _paid_reservation_without_invoice() -> tuple[dict, UUID]:
    """A reservation whose rental payment is recorded as succeeded, with no
    invoice, as a payment taken before invoices existed would be. Also what
    issuing is raced against."""

    reservation = _reservation()
    client.get(f"/api/reservations/{reservation['id']}/handover")

    db = SessionLocal()
    handover = db.scalar(
        select(Handover).where(Handover.reservation_id == UUID(reservation["id"]))
    )
    handover.payment_status = "SUCCEEDED"
    handover.payment_method = "CASH"
    handover.payment_amount = Decimal("90.00")
    handover.payment_currency = "eur"
    db.commit()
    handover_id = handover.id
    db.close()

    return reservation, handover_id


def _paid_handover_without_invoice() -> UUID:
    return _paid_reservation_without_invoice()[1]


# --- credit notes -------------------------------------------------------------------


def test_refunding_a_payment_issues_a_credit_note(vat):
    vat(22, True)
    reservation = _reservation()

    _pay_cash(reservation)
    original = _invoices(reservation["id"])[0]

    assert _cancel(reservation).status_code == 200  # cancelling refunds

    documents = _invoices(reservation["id"])
    assert [d["kind"] for d in documents] == ["INVOICE", "CREDIT_NOTE"]

    note = documents[1]
    assert note["number"].startswith("CN-")
    assert note["credits_invoice_number"] == original["number"]
    assert note["total_amount"] == -original["total_amount"]
    assert note["vat_amount"] == -original["vat_amount"]
    assert note["net_amount"] == -original["net_amount"]

    # The original is untouched.
    assert documents[0] == original


def test_a_payment_with_no_invoice_gets_no_credit_note():
    # A payment taken before invoices existed has none, and refunding it must
    # not invent a document with today's date for an old sale.
    reservation, _ = _paid_reservation_without_invoice()

    assert _cancel(reservation).status_code == 200

    assert _invoices(reservation["id"]) == []


# --- numbering ------------------------------------------------------------------------


def test_numbers_are_unique_and_the_sequence_has_no_gaps(vat):
    vat(0)
    reservations = [_reservation() for _ in range(3)]

    try:
        for reservation in reservations:
            _pay_cash(reservation)
    finally:
        for reservation in reservations:
            _cancel(reservation)

    db = SessionLocal()
    sequences = sorted(db.scalars(select(Invoice.sequence)))
    numbers = list(db.scalars(select(Invoice.number)))
    db.close()

    assert len(numbers) == len(set(numbers))
    assert sequences == list(range(1, len(sequences) + 1))


def test_concurrent_issuers_get_different_numbers_and_no_gap():
    handover_ids = [_paid_handover_without_invoice() for _ in range(4)]
    barrier = threading.Barrier(len(handover_ids))
    errors = []

    def issue(handover_id):
        db = SessionLocal()
        try:
            handover = db.get(Handover, handover_id)
            barrier.wait()
            issue_invoice_for_handover(db, handover, None)
            db.commit()
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)
            db.rollback()
        finally:
            db.close()

    threads = [threading.Thread(target=issue, args=(hid,)) for hid in handover_ids]
    [t.start() for t in threads]
    [t.join() for t in threads]

    assert errors == []

    db = SessionLocal()
    sequences = sorted(db.scalars(select(Invoice.sequence)))
    mine = list(db.scalars(select(Invoice).where(Invoice.handover_id.in_(handover_ids))))
    db.close()

    assert len(mine) == 4
    assert len({i.number for i in mine}) == 4
    assert sequences == list(range(1, len(sequences) + 1))


def test_two_issuers_racing_for_the_same_payment_make_one_invoice():
    handover_id = _paid_handover_without_invoice()
    barrier = threading.Barrier(2)
    errors = []

    def issue():
        db = SessionLocal()
        try:
            handover = db.get(Handover, handover_id)
            barrier.wait()
            issue_invoice_for_handover(db, handover, None)
            db.commit()
        except Exception as exc:  # pragma: no cover
            errors.append(exc)
            db.rollback()
        finally:
            db.close()

    threads = [threading.Thread(target=issue) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]

    assert errors == []

    db = SessionLocal()
    count = db.scalar(select(func.count(Invoice.id)).where(Invoice.handover_id == handover_id))
    sequences = sorted(db.scalars(select(Invoice.sequence)))
    db.close()

    assert count == 1
    # The loser's number was given back, not skipped.
    assert sequences == list(range(1, len(sequences) + 1))


def test_a_rolled_back_invoice_does_not_use_up_a_number():
    handover_id = _paid_handover_without_invoice()

    db = SessionLocal()
    before = db.scalar(select(func.max(Invoice.sequence))) or 0
    handover = db.get(Handover, handover_id)
    issue_invoice_for_handover(db, handover, None)
    db.rollback()  # the payment confirmation that wanted it failed
    db.close()

    db = SessionLocal()
    handover = db.get(Handover, handover_id)
    invoice = issue_invoice_for_handover(db, handover, None)
    db.commit()
    assert invoice.sequence == before + 1
    db.close()


# --- the webhook path -------------------------------------------------------------------


def _signed_post(event: dict):
    secret = "whsec_invoice_tests"
    config.STRIPE_WEBHOOK_SECRET = secret
    payload = json.dumps(event).encode()
    stamp = int(time.time())
    digest = hmac.new(secret.encode(), f"{stamp}.".encode() + payload, hashlib.sha256).hexdigest()

    return client.post(
        "/api/stripe/webhook",
        content=payload,
        headers={"stripe-signature": f"t={stamp},v1={digest}", "content-type": "application/json"},
    )


def test_a_webhook_confirmed_card_payment_is_invoiced_once(vat, monkeypatch):
    vat(0)
    monkeypatch.setattr(config, "STRIPE_WEBHOOK_SECRET", "whsec_invoice_tests")
    reservation = _reservation()
    client.get(f"/api/reservations/{reservation['id']}/handover")
    intent_id = f"pi_test_{uuid.uuid4().hex}"

    db = SessionLocal()
    handover = db.scalar(
        select(Handover).where(Handover.reservation_id == UUID(reservation["id"]))
    )
    handover.stripe_payment_intent_id = intent_id
    handover.payment_method = "CARD"
    handover.payment_status = "PROCESSING"
    handover.payment_amount = Decimal("120.00")
    handover.payment_currency = "eur"
    db.commit()
    db.close()

    def event():
        return {
            "id": f"evt_{uuid.uuid4().hex}",
            "object": "event",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": intent_id, "object": "payment_intent", "status": "succeeded"}},
        }

    try:
        assert _signed_post(event()).status_code == 200
        assert _signed_post(event()).status_code == 200  # a different event, same payment

        invoices = _invoices(reservation["id"])
        assert len(invoices) == 1
        assert invoices[0]["total_amount"] == 120.0
    finally:
        _cancel(reservation)


# --- documents and access ------------------------------------------------------------------


def test_invoice_and_credit_note_pdfs_download(vat):
    vat(22, True)
    reservation = _reservation()

    _pay_cash(reservation)
    _cancel(reservation)
    documents = _invoices(reservation["id"])

    for document in documents:
        response = client.get(f"/api/invoices/{document['id']}/pdf")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")
        assert document["number"] in response.headers["content-disposition"]


def test_unknown_invoice_and_reservation_are_404():
    assert client.get(f"/api/invoices/{uuid.uuid4()}/pdf").status_code == 404
    assert client.get(f"/api/reservations/{uuid.uuid4()}/invoices").status_code == 404


def test_invoices_need_a_login():
    app.dependency_overrides.pop(get_current_user, None)

    try:
        assert client.get(f"/api/reservations/{uuid.uuid4()}/invoices").status_code == 401
        assert client.get(f"/api/invoices/{uuid.uuid4()}/pdf").status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = _get_fake_user
