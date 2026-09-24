import os
from uuid import UUID, uuid4

import pytest
import stripe
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog, Customer, Handover
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    get_location_id,
)


client = TestClient(app)

# Matches tests/conftest.py's _fake_user, which every request in this
# suite authenticates as by default.
TEST_SUITE_USER_ID = UUID("00000000-0000-0000-0000-000000000000")

requires_stripe = pytest.mark.skipif(
    not os.getenv("STRIPE_SECRET_KEY"),
    reason="STRIPE_SECRET_KEY not configured in this environment.",
)


def _mark_identity_verified(customer_id: str) -> None:
    """
    Stripe Identity's document/selfie check is UI-driven — even in test
    mode there's no pure-API call that completes a VerificationSession
    the way stripe.PaymentIntent.confirm(..., "pm_card_visa") completes
    a payment, so tests that need generate_agreement() to succeed set
    the cached status directly rather than driving Stripe's own hosted
    flow (which is exercised, and its own correctness owned, by Stripe).
    """

    db = SessionLocal()
    try:
        customer = db.get(Customer, UUID(customer_id))
        customer.identity_verification_status = "verified"
        db.commit()
    finally:
        db.close()


def _reset_identity_verification(customer_id: str) -> None:
    """
    Undoes _mark_identity_verified. create_reservation() (shared by
    every test in this file) always books the same fixed "Test User"
    identity, so find_matching_customer resolves every call to the same
    underlying Customer row — without this, marking it verified in one
    test would permanently leak into every other test file's customer
    lookups against the same persistent dev database.
    """

    db = SessionLocal()
    try:
        customer = db.get(Customer, UUID(customer_id))
        customer.identity_verification_status = None
        customer.national_id_number = None
        customer.id_document_type = None
        customer.id_document_number = None
        customer.id_document_expires_at = None
        customer.driving_license_number = None
        customer.driving_license_country = None
        customer.driving_license_categories = None
        customer.driving_license_issued_at = None
        customer.driving_license_expires_at = None
        customer.identity_checked_at = None
        customer.identity_checked_by = None
        db.commit()
    finally:
        db.close()


TINY_SIGNATURE = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAA"
    "C0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _employee_sign(reservation_id: str):
    """The approving employee's signature, after the customer's."""
    response = client.post(
        f"/api/reservations/{reservation_id}/handover/employee-signature",
        json={"signature_image": TINY_SIGNATURE},
    )
    assert response.status_code == 200

    return response


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
    _employee_sign(reservation["id"])
    assert signature_response.status_code == 200
    assert signature_response.json()["has_signature"] is True

    _mark_identity_verified(reservation["customer"]["id"])

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

    # Clean up: complete the rental so the car returns to AVAILABLE, and
    # un-verify the shared customer so it doesn't leak into other tests.
    client.patch(
        f"/api/reservations/{reservation['id']}/status",
        json={"status": "COMPLETED"},
    )
    _reset_identity_verification(reservation["customer"]["id"])


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


@requires_stripe
def test_generate_agreement_rejected_without_identity_verification():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-01-05T10:00:00Z", "2027-01-06T10:00:00Z"
    )

    intent_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/payment-intent"
    )
    client_secret = intent_response.json()["client_secret"]
    intent_id = client_secret.split("_secret")[0]

    stripe.PaymentIntent.confirm(intent_id, payment_method="pm_card_visa")
    client.post(f"/api/reservations/{reservation['id']}/handover/confirm-payment")

    client.post(
        f"/api/reservations/{reservation['id']}/handover/signature",
        json={"signature_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="},
    )
    _employee_sign(reservation["id"])

    response = client.post(f"/api/reservations/{reservation['id']}/handover/agreement")

    assert response.status_code == 400
    assert "identity" in response.json()["detail"].lower()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


@requires_stripe
def test_confirm_payment_sets_attribution_and_audit_log():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-02-01T10:00:00Z", "2027-02-03T10:00:00Z"
    )

    intent_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/payment-intent"
    )
    client_secret = intent_response.json()["client_secret"]
    intent_id = client_secret.split("_secret")[0]

    stripe.PaymentIntent.confirm(intent_id, payment_method="pm_card_visa")

    confirm_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/confirm-payment"
    )
    assert confirm_response.status_code == 200

    db = SessionLocal()
    try:
        handover = (
            db.query(Handover)
            .filter(Handover.reservation_id == UUID(reservation["id"]))
            .first()
        )
        assert handover.created_by == TEST_SUITE_USER_ID
        assert handover.updated_by == TEST_SUITE_USER_ID

        entry = (
            db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "handover",
                AuditLog.entity_id == handover.id,
                AuditLog.action == "handover.payment_confirmed",
            )
            .first()
        )
        assert entry is not None
        assert entry.user_id == TEST_SUITE_USER_ID
    finally:
        db.close()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


@requires_stripe
def test_generate_agreement_records_audit_log():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-02-05T10:00:00Z", "2027-02-07T10:00:00Z"
    )

    intent_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/payment-intent"
    )
    client_secret = intent_response.json()["client_secret"]
    intent_id = client_secret.split("_secret")[0]

    stripe.PaymentIntent.confirm(intent_id, payment_method="pm_card_visa")
    client.post(f"/api/reservations/{reservation['id']}/handover/confirm-payment")

    client.post(
        f"/api/reservations/{reservation['id']}/handover/signature",
        json={"signature_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="},
    )
    _employee_sign(reservation["id"])

    _mark_identity_verified(reservation["customer"]["id"])

    agreement_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/agreement"
    )
    assert agreement_response.status_code == 200

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
                AuditLog.action == "handover.agreement_generated",
            )
            .first()
        )
        assert entry is not None
    finally:
        db.close()

    client.patch(
        f"/api/reservations/{reservation['id']}/status",
        json={"status": "COMPLETED"},
    )
    _reset_identity_verification(reservation["customer"]["id"])


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


def test_confirm_cash_payment_records_audit_log():
    # No @requires_stripe here — cash never touches Stripe, so this
    # should pass in any environment, Stripe-configured or not.
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-03-15T10:00:00Z", "2027-03-16T10:00:00Z"
    )

    response = client.post(
        f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["payment_status"] == "SUCCEEDED"
    assert body["payment_method"] == "CASH"
    assert body["stripe_payment_intent_id"] is None

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
                AuditLog.action == "handover.payment_confirmed",
            )
            .order_by(AuditLog.created_at.desc())
            .first()
        )
        assert entry is not None
        assert entry.details["payment_method"] == "CASH"
    finally:
        db.close()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_confirm_cash_payment_404_for_unknown_reservation():
    response = client.post(
        f"/api/reservations/{uuid4()}/handover/confirm-cash-payment"
    )

    assert response.status_code == 404


def test_cash_payment_full_flow():
    # Exercises the whole handover→agreement path (cash payment,
    # signature, identity verification, agreement generation) without
    # any Stripe involvement at all — cash and Stripe Identity's
    # verified-status check (bypassed the same way _mark_identity_verified
    # bypasses it for the card-based full-flow test) are both
    # Stripe-account-independent here, so no @requires_stripe.
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-03-18T10:00:00Z", "2027-03-19T10:00:00Z"
    )

    payment_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
    )
    assert payment_response.status_code == 200
    assert payment_response.json()["payment_status"] == "SUCCEEDED"

    signature_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/signature",
        json={"signature_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="},
    )
    _employee_sign(reservation["id"])
    assert signature_response.status_code == 200

    _mark_identity_verified(reservation["customer"]["id"])

    agreement_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/agreement"
    )
    assert agreement_response.status_code == 200
    assert agreement_response.json()["has_agreement"] is True

    updated_reservation = client.get(f"/api/reservations/{reservation['id']}").json()
    assert updated_reservation["status"] == "ACTIVE"

    client.patch(
        f"/api/reservations/{reservation['id']}/status",
        json={"status": "COMPLETED"},
    )
    _reset_identity_verification(reservation["customer"]["id"])


def _cash_paid_and_customer_signed(plate: str, pickup_at: str, return_at: str) -> dict:
    reservation = create_confirmed_reservation(plate, pickup_at, return_at)

    client.post(
        f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
    )
    client.post(
        f"/api/reservations/{reservation['id']}/handover/signature",
        json={"signature_image": TINY_SIGNATURE},
    )

    return reservation


def test_employee_signature_requires_customer_signature_first():
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-04-01T10:00:00Z", "2027-04-02T10:00:00Z"
    )

    try:
        response = client.post(
            f"/api/reservations/{reservation['id']}/handover/employee-signature",
            json={"signature_image": TINY_SIGNATURE},
        )

        assert response.status_code == 400
        assert "customer must sign" in response.json()["detail"].lower()
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_generate_agreement_rejected_without_employee_signature():
    reservation = _cash_paid_and_customer_signed(
        "SA-008-AA", "2027-04-03T10:00:00Z", "2027-04-04T10:00:00Z"
    )
    _mark_identity_verified(reservation["customer"]["id"])

    try:
        response = client.post(
            f"/api/reservations/{reservation['id']}/handover/agreement"
        )

        assert response.status_code == 400
        assert "employee signature" in response.json()["detail"].lower()
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")
        _reset_identity_verification(reservation["customer"]["id"])


def test_employee_signature_records_who_approved_and_is_audited():
    reservation = _cash_paid_and_customer_signed(
        "SA-008-AA", "2027-04-05T10:00:00Z", "2027-04-06T10:00:00Z"
    )

    try:
        signed = _employee_sign(reservation["id"]).json()

        assert signed["has_employee_signature"] is True
        assert signed["employee_signed_by_email"] == "test-suite@example.com"
        assert signed["employee_signed_at"] is not None
        assert signed["employee_signature_image"] == TINY_SIGNATURE

        fetched = client.get(
            f"/api/reservations/{reservation['id']}/handover"
        ).json()
        assert fetched["employee_signed_by_email"] == "test-suite@example.com"

        db = SessionLocal()
        try:
            rows = (
                db.query(AuditLog)
                .filter(
                    AuditLog.entity_type == "handover",
                    AuditLog.entity_id == UUID(signed["id"]),
                    AuditLog.action == "handover.employee_signed",
                )
                .all()
            )
            assert len(rows) == 1
            assert rows[0].user_id == TEST_SUITE_USER_ID
        finally:
            db.close()
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_agreement_with_employee_signature_carries_approver():
    reservation = _cash_paid_and_customer_signed(
        "SA-008-AA", "2027-04-07T10:00:00Z", "2027-04-08T10:00:00Z"
    )
    _employee_sign(reservation["id"])
    _mark_identity_verified(reservation["customer"]["id"])

    try:
        agreement = client.post(
            f"/api/reservations/{reservation['id']}/handover/agreement"
        )
        assert agreement.status_code == 200
        assert agreement.json()["employee_signed_by_email"] == "test-suite@example.com"

        download = client.get(
            f"/api/reservations/{reservation['id']}/handover/agreement/download"
        )
        assert download.status_code == 200
        assert download.content.startswith(b"%PDF")
    finally:
        client.patch(
            f"/api/reservations/{reservation['id']}/status",
            json={"status": "COMPLETED"},
        )
        _reset_identity_verification(reservation["customer"]["id"])
