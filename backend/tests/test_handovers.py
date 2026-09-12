import os
from uuid import uuid4

import pytest
import stripe
from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    get_location_id,
)


client = TestClient(app)

requires_stripe = pytest.mark.skipif(
    not os.getenv("STRIPE_SECRET_KEY"),
    reason="STRIPE_SECRET_KEY not configured in this environment.",
)


def create_confirmed_reservation(plate: str, pickup_at: str, return_at: str) -> dict:
    """Create a PENDING reservation and immediately approve it to CONFIRMED."""
    aho_id = get_location_id("AHO")
    car = ensure_car_available(plate)

    reservation = create_reservation(car["id"], aho_id, pickup_at, return_at)

    approve_response = client.patch(
        f"/api/reservations/{reservation['id']}/status",
        json={"status": "CONFIRMED"},
    )
    assert approve_response.status_code == 200

    return approve_response.json()


@requires_stripe
def test_payment_intent_created_and_confirmed_with_test_card():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    reservation = create_confirmed_reservation(
        "SA-008-AA", "2026-11-20T10:00:00Z", "2026-11-22T10:00:00Z"
    )

    intent_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/payment-intent"
    )
    assert intent_response.status_code == 200

    client_secret = intent_response.json()["client_secret"]
    intent_id = client_secret.split("_secret")[0]

    stripe.PaymentIntent.confirm(intent_id, payment_method="pm_card_visa")

    confirm_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/confirm-payment"
    )
    assert confirm_response.status_code == 200
    assert confirm_response.json()["payment_status"] == "SUCCEEDED"

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


@requires_stripe
def test_generate_agreement_full_flow():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    reservation = create_confirmed_reservation(
        "SA-008-AA", "2026-11-24T10:00:00Z", "2026-11-26T10:00:00Z"
    )

    intent_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/payment-intent"
    )
    client_secret = intent_response.json()["client_secret"]
    intent_id = client_secret.split("_secret")[0]

    stripe.PaymentIntent.confirm(intent_id, payment_method="pm_card_visa")
    client.post(f"/api/reservations/{reservation['id']}/handover/confirm-payment")

    signature_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/signature",
        json={"signature_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="},
    )
    assert signature_response.status_code == 200
    assert signature_response.json()["has_signature"] is True

    agreement_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/agreement"
    )
    assert agreement_response.status_code == 200
    assert agreement_response.json()["has_agreement"] is True

    updated_reservation = client.get(f"/api/reservations/{reservation['id']}").json()
    assert updated_reservation["status"] == "ACTIVE"

    car = client.get(f"/api/cars/{reservation['car']['id']}").json()
    assert car["status"] == "RENTED"

    download_response = client.get(
        f"/api/reservations/{reservation['id']}/handover/agreement/download"
    )
    assert download_response.status_code == 200
    assert download_response.headers["content-type"] == "application/pdf"

    # Clean up: complete the rental so the car returns to AVAILABLE.
    client.patch(
        f"/api/reservations/{reservation['id']}/status",
        json={"status": "COMPLETED"},
    )


@requires_stripe
def test_generate_agreement_rejected_without_payment():
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2026-11-27T10:00:00Z", "2026-11-28T10:00:00Z"
    )

    response = client.post(f"/api/reservations/{reservation['id']}/handover/agreement")

    assert response.status_code == 400
    assert "payment" in response.json()["detail"].lower()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


@requires_stripe
def test_generate_agreement_rejected_without_signature():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    reservation = create_confirmed_reservation(
        "SA-008-AA", "2026-11-29T10:00:00Z", "2026-11-30T10:00:00Z"
    )

    intent_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/payment-intent"
    )
    client_secret = intent_response.json()["client_secret"]
    intent_id = client_secret.split("_secret")[0]

    stripe.PaymentIntent.confirm(intent_id, payment_method="pm_card_visa")
    client.post(f"/api/reservations/{reservation['id']}/handover/confirm-payment")

    response = client.post(f"/api/reservations/{reservation['id']}/handover/agreement")

    assert response.status_code == 400
    assert "signature" in response.json()["detail"].lower()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_handover_endpoints_404_for_unknown_reservation():
    response = client.get(f"/api/reservations/{uuid4()}/handover")

    assert response.status_code == 404


@requires_stripe
def test_payment_intent_amount_includes_short_term_surcharge():
    # SA-008-AA (Fiat Panda) is 42.00/day, same-airport pickup/return, and
    # this 2-day trip is under the 5-day short-term threshold.
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2026-12-01T10:00:00Z", "2026-12-03T10:00:00Z"
    )

    intent_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/payment-intent"
    )
    assert intent_response.status_code == 200

    body = intent_response.json()
    assert body["base_amount"] == 84.0  # 42.00 x 2 days
    assert body["short_term_fee"] == 30.0
    assert body["airport_change_fee"] == 0.0
    assert body["payment_amount"] == 114.0

    client.patch(f"/api/reservations/{reservation['id']}/cancel")
