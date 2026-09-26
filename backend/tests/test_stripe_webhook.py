import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import config
from app.database import SessionLocal
from tests._dates import far_future_days
from app.main import app
from app.models import AuditLog, Handover, ProcessedStripeEvent
from app.services.stripe_sync import (
    apply_deposit_intent_status,
    apply_payment_intent_status,
)
from tests.test_handovers import create_confirmed_reservation

client = TestClient(app)

SECRET = "whsec_test_secret_for_pytest"


@pytest.fixture(autouse=True)
def _webhook_secret(monkeypatch):
    monkeypatch.setattr(config, "STRIPE_WEBHOOK_SECRET", SECRET)


def _sign(payload: bytes, secret: str = SECRET, timestamp: int | None = None) -> str:
    timestamp = timestamp or int(time.time())
    signed = f"{timestamp}.".encode() + payload
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()

    return f"t={timestamp},v1={digest}"


def _event(event_type: str, intent_id: str, status: str, event_id: str | None = None):
    return {
        "id": event_id or f"evt_{uuid.uuid4().hex}",
        "object": "event",
        "type": event_type,
        "data": {"object": {"id": intent_id, "object": "payment_intent", "status": status}},
    }


def _post(event: dict, signature: str | None = None):
    payload = json.dumps(event).encode()

    return client.post(
        "/api/stripe/webhook",
        content=payload,
        headers={
            "stripe-signature": signature or _sign(payload),
            "content-type": "application/json",
        },
    )


def _reservation_with_handover(**handover_fields):
    offset = far_future_days()
    pickup = datetime.now(timezone.utc) + timedelta(days=offset)
    reservation = create_confirmed_reservation(
        "SA-008-AA",
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (pickup + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    client.get(f"/api/reservations/{reservation['id']}/handover")

    db = SessionLocal()
    handover = db.scalar(
        select(Handover).where(Handover.reservation_id == UUID(reservation["id"]))
    )
    for name, value in handover_fields.items():
        setattr(handover, name, value)
    db.commit()
    handover_id = handover.id
    db.close()

    return reservation, handover_id


def _handover(handover_id) -> Handover:
    db = SessionLocal()
    try:
        handover = db.get(Handover, handover_id)
        db.expunge(handover)
        return handover
    finally:
        db.close()


def _cleanup(reservation):
    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def _new_intent_id() -> str:
    return f"pi_test_{uuid.uuid4().hex}"


# --- signature and configuration ----------------------------------------


def test_rejects_a_bad_signature():
    event = _event("payment_intent.succeeded", _new_intent_id(), "succeeded")

    assert _post(event, signature="t=1,v1=deadbeef").status_code == 400


def test_rejects_a_signature_from_the_wrong_secret():
    event = _event("payment_intent.succeeded", _new_intent_id(), "succeeded")
    payload = json.dumps(event).encode()

    assert _post(event, signature=_sign(payload, secret="whsec_other")).status_code == 400


def test_rejects_a_missing_signature():
    response = client.post("/api/stripe/webhook", content=b"{}")

    assert response.status_code == 400


def test_rejects_an_old_timestamp():
    event = _event("payment_intent.succeeded", _new_intent_id(), "succeeded")
    payload = json.dumps(event).encode()
    stale = int(time.time()) - 3600

    assert _post(event, signature=_sign(payload, timestamp=stale)).status_code == 400


def test_refuses_everything_when_no_secret_is_configured(monkeypatch):
    monkeypatch.setattr(config, "STRIPE_WEBHOOK_SECRET", None)
    event = _event("payment_intent.succeeded", _new_intent_id(), "succeeded")

    assert _post(event).status_code == 503


def test_needs_no_login():
    # The suite-wide auth override is irrelevant to this route: it never
    # asks for a token, only for a valid Stripe signature.
    event = _event("charge.refunded", _new_intent_id(), "succeeded")

    assert _post(event).status_code == 200


# --- applying events ----------------------------------------------------


def test_succeeded_event_marks_the_payment_paid_and_is_audited():
    intent_id = _new_intent_id()
    reservation, handover_id = _reservation_with_handover(
        stripe_payment_intent_id=intent_id,
        payment_method="CARD",
        payment_status="PROCESSING",
    )

    try:
        response = _post(_event("payment_intent.succeeded", intent_id, "succeeded"))

        assert response.status_code == 200
        assert response.json()["result"] == "applied"

        handover = _handover(handover_id)
        assert handover.payment_status == "SUCCEEDED"
        assert handover.paid_at is not None

        db = SessionLocal()
        entry = db.scalar(
            select(AuditLog).where(
                AuditLog.entity_id == handover_id,
                AuditLog.action == "handover.payment_confirmed",
            )
        )
        db.close()
        assert entry is not None
        assert entry.user_id is None
        assert entry.details["source"] == "stripe_webhook"
    finally:
        _cleanup(reservation)


def test_a_replayed_event_is_applied_only_once():
    intent_id = _new_intent_id()
    reservation, handover_id = _reservation_with_handover(
        stripe_payment_intent_id=intent_id,
        payment_method="CARD",
        payment_status="PROCESSING",
    )
    event = _event("payment_intent.succeeded", intent_id, "succeeded")

    try:
        assert _post(event).json()["result"] == "applied"
        first_paid_at = _handover(handover_id).paid_at

        assert _post(event).json()["result"] == "duplicate"
        assert _handover(handover_id).paid_at == first_paid_at

        db = SessionLocal()
        rows = db.scalars(
            select(ProcessedStripeEvent).where(ProcessedStripeEvent.event_id == event["id"])
        ).all()
        db.close()
        assert len(rows) == 1
    finally:
        _cleanup(reservation)


def test_an_unknown_intent_is_ignored_not_an_error():
    response = _post(_event("payment_intent.canceled", _new_intent_id(), "canceled"))

    assert response.status_code == 200
    assert response.json()["result"] == "ignored"


def test_a_cancel_event_for_a_replaced_intent_does_not_touch_the_new_one():
    old_intent = _new_intent_id()
    new_intent = _new_intent_id()
    reservation, handover_id = _reservation_with_handover(
        stripe_payment_intent_id=new_intent,
        payment_method="CARD",
        payment_status="PROCESSING",
    )

    try:
        # The old intent was cancelled when it was replaced; Stripe reports it.
        _post(_event("payment_intent.canceled", old_intent, "canceled"))

        assert _handover(handover_id).payment_status == "PROCESSING"
    finally:
        _cleanup(reservation)


def test_a_late_event_never_undoes_a_success():
    intent_id = _new_intent_id()
    reservation, handover_id = _reservation_with_handover(
        stripe_payment_intent_id=intent_id,
        payment_method="CARD",
        payment_status="PROCESSING",
    )

    try:
        _post(_event("payment_intent.succeeded", intent_id, "succeeded"))
        paid_at = _handover(handover_id).paid_at

        _post(_event("payment_intent.processing", intent_id, "processing"))
        _post(_event("payment_intent.canceled", intent_id, "canceled"))

        handover = _handover(handover_id)
        assert handover.payment_status == "SUCCEEDED"
        assert handover.paid_at == paid_at
    finally:
        _cleanup(reservation)


def test_a_refunded_payment_stays_refunded():
    intent_id = _new_intent_id()
    reservation, handover_id = _reservation_with_handover(
        stripe_payment_intent_id=intent_id,
        payment_method="CARD",
        payment_status="REFUNDED",
    )

    try:
        _post(_event("payment_intent.succeeded", intent_id, "succeeded"))

        assert _handover(handover_id).payment_status == "REFUNDED"
    finally:
        _cleanup(reservation)


def test_a_failed_attempt_can_still_succeed_later():
    intent_id = _new_intent_id()
    reservation, handover_id = _reservation_with_handover(
        stripe_payment_intent_id=intent_id,
        payment_method="CARD",
        payment_status="PROCESSING",
    )

    try:
        _post(_event("payment_intent.payment_failed", intent_id, "requires_payment_method"))
        assert _handover(handover_id).payment_status == "FAILED"

        _post(_event("payment_intent.succeeded", intent_id, "succeeded"))
        assert _handover(handover_id).payment_status == "SUCCEEDED"
    finally:
        _cleanup(reservation)


def test_card_deposit_authorization_marks_the_deposit_held():
    intent_id = _new_intent_id()
    reservation, handover_id = _reservation_with_handover(
        deposit_stripe_payment_intent_id=intent_id,
        deposit_method="CARD",
        deposit_status="PENDING",
    )

    try:
        _post(_event("payment_intent.amount_capturable_updated", intent_id, "requires_capture"))

        handover = _handover(handover_id)
        assert handover.deposit_status == "HELD"
        assert handover.deposit_held_at is not None
    finally:
        _cleanup(reservation)


# --- the shared rules, directly -----------------------------------------


class _Record:
    def __init__(self, **fields):
        self.payment_method = "CARD"
        self.payment_status = "PROCESSING"
        self.paid_at = None
        self.deposit_method = "CARD"
        self.deposit_status = "PENDING"
        self.deposit_held_at = None
        self.__dict__.update(fields)


def test_cash_payments_are_never_changed_by_stripe():
    record = _Record(payment_method="CASH", payment_status="SUCCEEDED")

    assert apply_payment_intent_status(record, "canceled") is False
    assert record.payment_status == "SUCCEEDED"


def test_paid_at_keeps_the_first_payment_time():
    record = _Record()

    apply_payment_intent_status(record, "succeeded")
    first = record.paid_at
    apply_payment_intent_status(record, "succeeded")

    assert record.paid_at == first


def test_a_held_deposit_is_not_moved_by_stripe_events():
    record = _Record(deposit_status="HELD")

    assert apply_deposit_intent_status(record, "canceled") is False
    assert record.deposit_status == "HELD"
