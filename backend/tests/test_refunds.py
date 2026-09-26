import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
import stripe
from fastapi.testclient import TestClient

from app.database import SessionLocal
from tests._dates import far_future_days
from app.main import app
from app.models import AuditLog, Handover
from tests.test_handovers import create_confirmed_reservation


client = TestClient(app)

requires_stripe = pytest.mark.skipif(
    not os.getenv("STRIPE_SECRET_KEY"),
    reason="STRIPE_SECRET_KEY not configured in this environment.",
)


def _random_dates(days: int = 2) -> tuple[str, str]:
    # A far-future, pseudo-random offset so repeated runs of this file
    # never collide on "car already reserved" against the same shared,
    # persistent dev database — same pattern test_dashboard_revenue.py
    # already uses.
    offset_days = far_future_days()
    pickup = datetime.now(timezone.utc) + timedelta(days=offset_days)
    return_at = pickup + timedelta(days=days)

    return (
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        return_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _get_handover(reservation_id: str) -> dict:
    return client.get(f"/api/reservations/{reservation_id}/handover").json()


@requires_stripe
def test_cancel_refunds_card_payment():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    pickup_at, return_at = _random_dates()
    reservation = create_confirmed_reservation("SA-008-AA", pickup_at, return_at)

    intent_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/payment-intent"
    )
    client_secret = intent_response.json()["client_secret"]
    intent_id = client_secret.split("_secret")[0]

    stripe.PaymentIntent.confirm(intent_id, payment_method="pm_card_visa")
    client.post(f"/api/reservations/{reservation['id']}/handover/confirm-payment")

    handover_before = _get_handover(reservation["id"])
    assert handover_before["payment_status"] == "SUCCEEDED"
    paid_amount = handover_before["payment_amount"]

    cancel_response = client.patch(f"/api/reservations/{reservation['id']}/cancel")
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "CANCELLED"

    handover_after = _get_handover(reservation["id"])
    assert handover_after["payment_status"] == "REFUNDED"
    assert handover_after["refund_amount"] == paid_amount
    assert handover_after["refunded_at"] is not None
    assert handover_after["stripe_refund_id"] is not None

    db = SessionLocal()
    try:
        handover = (
            db.query(Handover)
            .filter(Handover.reservation_id == UUID(reservation["id"]))
            .first()
        )

        entry = (
            db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "handover",
                AuditLog.entity_id == handover.id,
                AuditLog.action == "handover.refund_issued",
            )
            .first()
        )
        assert entry is not None
        assert entry.details["method"] == "CARD"
        assert entry.details["amount"] == paid_amount
    finally:
        db.close()


def test_cancel_refunds_cash_payment():
    pickup_at, return_at = _random_dates()
    reservation = create_confirmed_reservation("SA-008-AA", pickup_at, return_at)

    payment_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
    )
    assert payment_response.status_code == 200
    paid_amount = payment_response.json()["payment_amount"]

    cancel_response = client.patch(f"/api/reservations/{reservation['id']}/cancel")
    assert cancel_response.status_code == 200

    handover_after = _get_handover(reservation["id"])
    assert handover_after["payment_status"] == "REFUNDED"
    assert handover_after["payment_method"] == "CASH"
    assert handover_after["refund_amount"] == paid_amount
    assert handover_after["refunded_at"] is not None
    assert handover_after["stripe_refund_id"] is None

    db = SessionLocal()
    try:
        handover = (
            db.query(Handover)
            .filter(Handover.reservation_id == UUID(reservation["id"]))
            .first()
        )

        entry = (
            db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "handover",
                AuditLog.entity_id == handover.id,
                AuditLog.action == "handover.refund_issued",
            )
            .first()
        )
        assert entry is not None
        assert entry.details["method"] == "CASH"
    finally:
        db.close()


def test_cancel_does_not_refund_unpaid_reservation():
    pickup_at, return_at = _random_dates()
    reservation = create_confirmed_reservation("SA-008-AA", pickup_at, return_at)

    # Establish an (unpaid) handover row first, same as opening the
    # finalize screen would.
    handover_before = _get_handover(reservation["id"])
    assert handover_before["payment_status"] == "PENDING"

    cancel_response = client.patch(f"/api/reservations/{reservation['id']}/cancel")
    assert cancel_response.status_code == 200

    handover_after = _get_handover(reservation["id"])
    assert handover_after["payment_status"] == "PENDING"
    assert handover_after["refund_amount"] is None
    assert handover_after["refunded_at"] is None


def test_cancel_with_no_handover_at_all_still_works():
    # A PENDING reservation that never reached the counter has no
    # Handover row yet — cancelling it must not error looking one up.
    pickup_at, return_at = _random_dates()
    reservation = create_confirmed_reservation("SA-008-AA", pickup_at, return_at)

    cancel_response = client.patch(f"/api/reservations/{reservation['id']}/cancel")
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "CANCELLED"
