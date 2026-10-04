"""
A cancelled booking must not take money, and money that is on its way when it
is cancelled must come back. Stripe is faked here, so these run without a key.
"""

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import stripe
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Handover, Invoice
from app.services.stripe_sync import handle_event
from tests.test_handovers import (
    TINY_SIGNATURE,
    _reset_identity_verification,
    create_confirmed_reservation,
)

client = TestClient(app)


@pytest.fixture
def fake_stripe(monkeypatch):
    """Records what the app asks Stripe to do. `intent_status` is what Stripe
    will say about the card payment when asked."""

    calls = SimpleNamespace(cancelled=[], refunds=[], intent_status="requires_payment_method")

    monkeypatch.setattr(stripe, "api_key", "sk_test_fake")
    monkeypatch.setattr(
        stripe.PaymentIntent,
        "retrieve",
        staticmethod(lambda intent_id: SimpleNamespace(id=intent_id, status=calls.intent_status)),
    )
    monkeypatch.setattr(
        stripe.PaymentIntent,
        "cancel",
        staticmethod(lambda intent_id: calls.cancelled.append(intent_id)),
    )
    monkeypatch.setattr(
        stripe.Refund,
        "create",
        staticmethod(
            lambda **kwargs: (calls.refunds.append(kwargs), SimpleNamespace(id="re_fake"))[1]
        ),
    )

    return calls


def _start_card_payment(reservation_id: str, intent_id: str) -> None:
    """Puts the handover where it is when the customer is mid-card-payment."""

    client.get(f"/api/reservations/{reservation_id}/handover")

    db = SessionLocal()
    try:
        handover = db.scalar(
            select(Handover).where(Handover.reservation_id == UUID(reservation_id))
        )
        handover.payment_method = "CARD"
        handover.payment_status = "PROCESSING"
        handover.payment_amount = 50
        handover.payment_currency = "eur"
        handover.stripe_payment_intent_id = intent_id
        db.commit()
    finally:
        db.close()


def _handover(reservation_id: str) -> Handover:
    db = SessionLocal()
    try:
        return db.scalar(
            select(Handover).where(Handover.reservation_id == UUID(reservation_id))
        )
    finally:
        db.close()


def _invoice_kinds(reservation_id: str) -> list[str]:
    db = SessionLocal()
    try:
        handover = db.scalar(
            select(Handover).where(Handover.reservation_id == UUID(reservation_id))
        )
        return sorted(
            invoice.kind
            for invoice in db.scalars(select(Invoice).where(Invoice.handover_id == handover.id))
        )
    finally:
        db.close()


def test_a_cancelled_booking_takes_no_cash_and_no_signature():
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-07-05T10:00:00Z", "2027-07-06T10:00:00Z"
    )
    reservation_id = reservation["id"]

    assert client.patch(f"/api/reservations/{reservation_id}/cancel").status_code == 200

    cash = client.post(f"/api/reservations/{reservation_id}/handover/confirm-cash-payment")
    assert cash.status_code == 400
    assert cash.json()["code"] == "handover.cannot_change_status"

    signature = client.post(
        f"/api/reservations/{reservation_id}/handover/signature",
        json={"signature_image": TINY_SIGNATURE},
    )
    assert signature.status_code == 400
    assert signature.json()["code"] == "handover.cannot_change_status"

    # Nothing was invoiced for the dead booking.
    assert _handover(reservation_id) is None or _invoice_kinds(reservation_id) == []


def test_cancelling_closes_a_card_payment_that_was_not_finished(fake_stripe):
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-07-07T10:00:00Z", "2027-07-08T10:00:00Z"
    )
    reservation_id = reservation["id"]
    _start_card_payment(reservation_id, intent_id := f"pi_unfinished_{uuid4().hex}")

    assert client.patch(f"/api/reservations/{reservation_id}/cancel").status_code == 200

    # The customer can no longer complete it, and nothing was charged.
    assert fake_stripe.cancelled == [intent_id]
    assert fake_stripe.refunds == []
    assert _handover(reservation_id).payment_status == "CANCELLED"


def test_cancelling_refunds_a_card_payment_that_went_through_meanwhile(fake_stripe):
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-07-09T10:00:00Z", "2027-07-10T10:00:00Z"
    )
    reservation_id = reservation["id"]
    _start_card_payment(reservation_id, f"pi_paid_meanwhile_{uuid4().hex}")
    fake_stripe.intent_status = "succeeded"

    assert client.patch(f"/api/reservations/{reservation_id}/cancel").status_code == 200

    handover = _handover(reservation_id)
    assert handover.payment_status == "REFUNDED"
    assert len(fake_stripe.refunds) == 1
    assert fake_stripe.cancelled == []
    # Invoiced when the payment was recorded, then reversed.
    assert _invoice_kinds(reservation_id) == ["CREDIT_NOTE", "INVOICE"]


def test_a_late_card_payment_on_a_cancelled_booking_is_refunded(fake_stripe):
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-07-11T10:00:00Z", "2027-07-12T10:00:00Z"
    )
    reservation_id = reservation["id"]
    intent_id = f"pi_late_{uuid4().hex}"
    _start_card_payment(reservation_id, intent_id)
    assert client.patch(f"/api/reservations/{reservation_id}/cancel").status_code == 200
    assert _handover(reservation_id).payment_status == "CANCELLED"

    # Stripe reports the payment succeeded after the cancellation committed
    # (the card went through before Stripe processed our cancel request).
    db = SessionLocal()
    try:
        result = handle_event(
            db,
            {
                "id": f"evt_{uuid4().hex}",
                "type": "payment_intent.succeeded",
                "data": {"object": {"id": intent_id, "status": "succeeded"}},
            },
        )
    finally:
        db.close()

    assert result == "applied"
    assert _handover(reservation_id).payment_status == "REFUNDED"
    assert len(fake_stripe.refunds) == 1
    assert _invoice_kinds(reservation_id) == ["CREDIT_NOTE", "INVOICE"]


def test_signature_cannot_be_replaced_once_the_rental_is_active():
    from tests.test_handovers import (
        _employee_sign,
        _mark_identity_verified,
        finish_rental,
    )

    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-07-13T10:00:00Z", "2027-07-14T10:00:00Z"
    )
    reservation_id = reservation["id"]

    client.post(f"/api/reservations/{reservation_id}/handover/confirm-cash-payment")
    client.post(
        f"/api/reservations/{reservation_id}/handover/signature",
        json={"signature_image": TINY_SIGNATURE},
    )
    _employee_sign(reservation_id)
    _mark_identity_verified(reservation["customer"]["id"])

    try:
        assert client.post(f"/api/reservations/{reservation_id}/handover/agreement").status_code == 200

        replaced = client.post(
            f"/api/reservations/{reservation_id}/handover/signature",
            json={"signature_image": TINY_SIGNATURE},
        )
        assert replaced.status_code == 400
        assert replaced.json()["code"] == "handover.cannot_change_status"
    finally:
        finish_rental(reservation_id)
        _reset_identity_verification(reservation["customer"]["id"])
