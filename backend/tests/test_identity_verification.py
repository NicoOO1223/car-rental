import os
from uuid import UUID, uuid4

import pytest
import stripe
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog, Customer
from tests.test_reservations import ensure_car_available, get_location_id


client = TestClient(app)

requires_stripe = pytest.mark.skipif(
    not os.getenv("STRIPE_SECRET_KEY"),
    reason="STRIPE_SECRET_KEY not configured in this environment.",
)


def create_customer(
    plate: str, pickup_at: str, return_at: str, unique_key: str
) -> str:
    """Creates a reservation purely to get a fresh Customer row, and
    returns its id — identity verification is customer-scoped, not
    reservation-scoped. Each caller uses its own date window (so tests
    don't collide on "car already reserved" against the same shared dev
    database) and its own customer identity fields (so
    find_matching_customer, which dedups on name/DOB/address/postal
    code, doesn't silently fold distinct tests onto the same Customer
    row — every other caller of create_reservation() in this suite uses
    the same fixed "Test User" identity). The reservation is cancelled
    immediately since only the Customer row it produced is needed."""

    aho_id = get_location_id("AHO")
    car = ensure_car_available(plate)

    response = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Identity",
                "last_name": unique_key,
                "date_of_birth": "1990-01-01",
                "address": f"{unique_key} Street 1",
                "postal_code": "9000ID",
                "phone_number": "+31600000001",
                "email": f"identity.{unique_key.lower()}@example.com",
            },
            "car_id": car["id"],
            "pickup_location_id": aho_id,
            "return_location_id": aho_id,
            "pickup_at": pickup_at,
            "return_at": return_at,
        },
    )
    assert response.status_code == 201
    reservation = response.json()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    return reservation["customer_id"]


@requires_stripe
def test_create_verification_session_stores_status_and_audits():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    customer_id = create_customer(
        "SA-008-AA", "2027-04-01T10:00:00Z", "2027-04-03T10:00:00Z", "StoresStatus"
    )

    response = client.post(f"/api/customers/{customer_id}/identity-verification")

    assert response.status_code == 200
    assert response.json()["client_secret"]

    db = SessionLocal()
    try:
        customer = db.get(Customer, UUID(customer_id))
        assert customer.identity_verification_session_id is not None
        assert customer.identity_verification_status is not None

        entry = (
            db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "customer",
                AuditLog.entity_id == customer.id,
                AuditLog.action == "customer.identity_verification_updated",
            )
            .first()
        )
        assert entry is not None
        assert entry.details["status"] == customer.identity_verification_status
    finally:
        db.close()


@requires_stripe
def test_create_verification_session_reuses_in_flight_session():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    customer_id = create_customer(
        "SA-008-AA", "2027-04-04T10:00:00Z", "2027-04-06T10:00:00Z", "ReusesSession"
    )

    first = client.post(f"/api/customers/{customer_id}/identity-verification")
    second = client.post(f"/api/customers/{customer_id}/identity-verification")

    assert first.status_code == 200
    assert second.status_code == 200

    db = SessionLocal()
    try:
        customer = db.get(Customer, UUID(customer_id))
        session_id = customer.identity_verification_session_id
    finally:
        db.close()

    # Both calls should have landed on the same underlying Stripe
    # session rather than creating a duplicate.
    assert session_id is not None


@requires_stripe
def test_refresh_verification_status_without_session_rejected():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    customer_id = create_customer(
        "SA-008-AA", "2027-04-07T10:00:00Z", "2027-04-09T10:00:00Z", "NoSessionYet"
    )

    response = client.post(f"/api/customers/{customer_id}/identity-verification/refresh")

    assert response.status_code == 400
    assert "no identity verification" in response.json()["detail"].lower()


@requires_stripe
def test_refresh_verification_status_after_create():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    customer_id = create_customer(
        "SA-008-AA", "2027-04-10T10:00:00Z", "2027-04-12T10:00:00Z", "RefreshAfterCreate"
    )

    client.post(f"/api/customers/{customer_id}/identity-verification")
    response = client.post(f"/api/customers/{customer_id}/identity-verification/refresh")

    assert response.status_code == 200
    assert response.json()["identity_verification"]["status"] is not None


@requires_stripe
def test_identity_verification_endpoints_404_for_unknown_customer():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    create_response = client.post(
        f"/api/customers/{uuid4()}/identity-verification"
    )
    assert create_response.status_code == 404

    refresh_response = client.post(
        f"/api/customers/{uuid4()}/identity-verification/refresh"
    )
    assert refresh_response.status_code == 404
