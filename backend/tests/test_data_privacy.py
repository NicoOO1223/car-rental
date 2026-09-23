import os
from uuid import UUID, uuid4

import pytest
import stripe
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, Customer, Handover, User
from tests.test_customers import create_reservation_with_customer
from tests.test_reservations import ensure_car_available, get_location_id


client = TestClient(app)

requires_stripe = pytest.mark.skipif(
    not os.getenv("STRIPE_SECRET_KEY"),
    reason="STRIPE_SECRET_KEY not configured in this environment.",
)

_ADMIN_ID = UUID("00000000-0000-0000-0000-000000000000")


def _as_staff():
    staff_user = User(
        id=_ADMIN_ID,
        email="test-suite@example.com",
        hashed_password="unused",
        role="staff",
        is_active=True,
    )
    app.dependency_overrides[get_current_user] = lambda: staff_user


def _restore_admin():
    # Re-point the override back to an admin user rather than popping it
    # — popping removes the override entirely, so any further request
    # made later in the same test (e.g. cleanup) falls through to the
    # real get_current_user dependency and 401s with no Authorization
    # header, silently no-op'ing whatever that call was supposed to do.
    admin_user = User(
        id=_ADMIN_ID,
        email="test-suite@example.com",
        hashed_password="unused",
        role="admin",
        is_active=True,
    )
    app.dependency_overrides[get_current_user] = lambda: admin_user


def _create_customer(unique_key: str, pickup_at: str, return_at: str) -> dict:
    """Every caller gets its own customer identity, not the suite-wide
    shared "Test User" — find_matching_customer would otherwise fold
    distinct erasure/export tests onto the same row. A random suffix is
    included (not just unique_key) so reruns against this same
    persistent dev database don't dedup onto a customer identity a
    previous run already created — export tests in particular never
    erase their customer, so its name would otherwise stay a stable
    dedup target and accumulate reservation history across every rerun."""

    suffix = uuid4().hex[:8]
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    return create_reservation_with_customer(
        car["id"],
        aho_id,
        pickup_at,
        return_at,
        {
            "first_name": "Privacy",
            "last_name": f"{unique_key}{suffix}",
            "date_of_birth": "1990-01-01",
            "address": f"{unique_key} Street 1",
            "postal_code": "9000PR",
            "phone_number": "+31600000002",
            "email": f"privacy.{unique_key.lower()}.{suffix}@example.com",
        },
    )


def _audit_rows(customer_id: str, action: str):
    db = SessionLocal()
    try:
        return (
            db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "customer",
                AuditLog.entity_id == UUID(customer_id),
                AuditLog.action == action,
            )
            .all()
        )
    finally:
        db.close()


def test_erase_customer_anonymizes_fields_and_blanks_signature():
    reservation = _create_customer(
        "EraseHappy", "2028-08-01T10:00:00Z", "2028-08-03T10:00:00Z"
    )
    customer_id = reservation["customer_id"]

    client.patch(
        f"/api/reservations/{reservation['id']}/status",
        json={"status": "CONFIRMED"},
    )
    client.post(
        f"/api/reservations/{reservation['id']}/handover/signature",
        json={"signature_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="},
    )
    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    response = client.post(f"/api/customers/{customer_id}/erase")

    assert response.status_code == 200
    body = response.json()
    assert body["first_name"] == "[Erased]"
    assert body["last_name"] == "[Erased]"
    assert body["address"] == "[Erased]"
    assert body["phone_number"] is None
    assert body["email"] is None
    assert body["anonymized_at"] is not None

    db = SessionLocal()
    try:
        customer = db.get(Customer, UUID(customer_id))
        assert customer.date_of_birth.isoformat() == "1900-01-01"
        assert customer.postal_code == "00000"

        handover = (
            db.query(Handover)
            .filter(Handover.reservation_id == UUID(reservation["id"]))
            .first()
        )
        assert handover.signature_image is None
    finally:
        db.close()

    # The reservation row itself must survive erasure intact.
    reservations = client.get(f"/api/customers/{customer_id}/reservations").json()
    assert any(r["id"] == reservation["id"] for r in reservations)

    entries = _audit_rows(customer_id, "customer.anonymized")
    assert len(entries) == 1
    assert entries[0].details["reservation_count"] >= 1


def test_erase_customer_already_erased_rejected():
    reservation = _create_customer(
        "EraseTwice", "2028-08-05T10:00:00Z", "2028-08-07T10:00:00Z"
    )
    customer_id = reservation["customer_id"]
    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    first = client.post(f"/api/customers/{customer_id}/erase")
    assert first.status_code == 200

    second = client.post(f"/api/customers/{customer_id}/erase")
    assert second.status_code == 400
    assert "already" in second.json()["detail"].lower()


def test_erase_customer_blocked_for_confirmed_reservation():
    reservation = _create_customer(
        "EraseBlocked", "2028-08-10T10:00:00Z", "2028-08-12T10:00:00Z"
    )
    customer_id = reservation["customer_id"]

    client.patch(
        f"/api/reservations/{reservation['id']}/status",
        json={"status": "CONFIRMED"},
    )

    response = client.post(f"/api/customers/{customer_id}/erase")

    assert response.status_code == 400
    assert "active or upcoming" in response.json()["detail"].lower()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_erase_customer_not_found():
    response = client.post(f"/api/customers/{uuid4()}/erase")
    assert response.status_code == 404


def test_erase_customer_rejects_staff_role():
    reservation = _create_customer(
        "EraseRbac", "2028-08-15T10:00:00Z", "2028-08-17T10:00:00Z"
    )
    customer_id = reservation["customer_id"]
    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    _as_staff()
    try:
        response = client.post(f"/api/customers/{customer_id}/erase")
        assert response.status_code == 403
    finally:
        _restore_admin()


def test_erased_customer_blocks_further_edits():
    reservation = _create_customer(
        "EraseNoEdit", "2028-08-20T10:00:00Z", "2028-08-22T10:00:00Z"
    )
    customer_id = reservation["customer_id"]
    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    erase_response = client.post(f"/api/customers/{customer_id}/erase")
    assert erase_response.status_code == 200

    update_response = client.patch(
        f"/api/customers/{customer_id}",
        json={"address": "Trying to un-erase"},
    )
    assert update_response.status_code == 400
    assert "erased" in update_response.json()["detail"].lower()


def test_export_customer_data_bundle_and_audit_log():
    reservation = _create_customer(
        "ExportHappy", "2028-08-25T10:00:00Z", "2028-08-27T10:00:00Z"
    )
    customer_id = reservation["customer_id"]

    response = client.get(f"/api/customers/{customer_id}/export")

    assert response.status_code == 200
    body = response.json()
    assert body["first_name"] == "Privacy"
    assert body["last_name"].startswith("ExportHappy")
    assert any(r["id"] == reservation["id"] for r in body["reservations"])
    assert body["exported_at"]

    entries = _audit_rows(customer_id, "customer.data_exported")
    assert len(entries) >= 1

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_export_customer_data_not_found():
    response = client.get(f"/api/customers/{uuid4()}/export")
    assert response.status_code == 404


def test_export_customer_data_rejects_staff_role():
    reservation = _create_customer(
        "ExportRbac", "2028-08-28T10:00:00Z", "2028-08-30T10:00:00Z"
    )
    customer_id = reservation["customer_id"]

    _as_staff()
    try:
        response = client.get(f"/api/customers/{customer_id}/export")
        assert response.status_code == 403
    finally:
        _restore_admin()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


@requires_stripe
def test_erase_customer_clears_identity_verification_fields():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    reservation = _create_customer(
        "EraseIdentity", "2028-09-01T10:00:00Z", "2028-09-03T10:00:00Z"
    )
    customer_id = reservation["customer_id"]

    session_response = client.post(
        f"/api/customers/{customer_id}/identity-verification"
    )
    assert session_response.status_code == 200

    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    response = client.post(f"/api/customers/{customer_id}/erase")

    assert response.status_code == 200
    assert response.json()["identity_verification"] is None
