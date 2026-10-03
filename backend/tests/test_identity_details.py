from datetime import date, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog, Customer
from tests.test_handovers import (
    TINY_SIGNATURE,
    _employee_sign,
    _reset_identity_verification,
    create_confirmed_reservation,
    finish_rental,
)
from tests.test_reservations import ensure_car_available


client = TestClient(app)

_WEIGHTS = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)


def make_pesel(body: str = "9001011234") -> str:
    """A valid PESEL: ten digits plus the checksum digit."""
    checksum = sum(w * int(d) for w, d in zip(_WEIGHTS, body)) % 10

    return body + str((10 - checksum) % 10)


def future(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def details_payload(**overrides) -> dict:
    payload = {
        "national_id_number": "X1234567",
        "id_document_type": "PASSPORT",
        "id_document_number": "P-99887766",
        "id_document_expires_at": future(3000),
        "driving_license_number": "DL-2020-0042",
        "driving_license_country": "de",
        "driving_license_categories": "B, BE",
        "driving_license_issued_at": "2015-06-01",
        "driving_license_expires_at": future(3000),
        "documents_checked": True,
    }
    payload.update(overrides)

    return payload


def create_customer(
    plate: str,
    pickup_at: str,
    return_at: str,
    unique_key: str,
    nationality: str | None = None,
) -> tuple[str, str]:
    """
    Creates a reservation purely to get a fresh, uniquely identified
    Customer row (find_matching_customer would otherwise fold distinct
    tests onto one row), cancels it, and returns (customer_id,
    reservation_id). The reservation id lets a test ask for the identity
    problem relative to that rental's end date.
    """

    car = ensure_car_available(plate)
    location_id = car["current_location"]["id"]

    customer = {
        "first_name": "Identity",
        "last_name": f"{unique_key}{uuid4().hex[:6]}",
        "date_of_birth": "1990-01-01",
        "address": f"{unique_key} Street 1",
        "postal_code": "9000ID",
        "phone_number": f"+3164{uuid4().int % 10**7:07d}",
        "email": f"identity.{uuid4().hex[:8]}@example.com",
    }

    if nationality:
        customer["nationality"] = nationality

    response = client.post(
        "/api/reservations",
        json={
            "customer": customer,
            "car_id": car["id"],
            "pickup_location_id": location_id,
            "return_location_id": location_id,
            "pickup_at": pickup_at,
            "return_at": return_at,
        },
    )
    assert response.status_code == 201
    reservation = response.json()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    return reservation["customer_id"], reservation["id"]


def audit_rows(customer_id: str, action: str):
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


def test_save_requires_documents_checked_confirmation():
    customer_id, _ = create_customer(
        "SA-006-AA", "2029-03-01T10:00:00Z", "2029-03-02T10:00:00Z", "Confirm"
    )

    response = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(documents_checked=False),
    )

    assert response.status_code == 400
    assert "original documents" in response.json()["detail"]


def test_save_stores_details_and_audits_without_values():
    customer_id, reservation_id = create_customer(
        "SA-006-AA", "2029-03-03T10:00:00Z", "2029-03-04T10:00:00Z", "Store"
    )

    response = client.put(
        f"/api/customers/{customer_id}/identity-details",
        params={"reservation_id": reservation_id},
        json=details_payload(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["national_id_number"] == "X1234567"
    assert body["driving_license_number"] == "DL-2020-0042"
    assert body["driving_license_country"] == "DE"
    assert body["identity_checked_at"] is not None
    assert body["identity_checked_by_email"] == "test-suite@example.com"
    assert body["problem"] is None

    (row,) = audit_rows(customer_id, "customer.identity_details_updated")
    assert "driving_license_number" in row.details["changed_fields"]
    # Field names only: the sensitive values never reach the audit log.
    assert "DL-2020-0042" not in str(row.details)
    assert "X1234567" not in str(row.details)


def test_pesel_is_validated_for_polish_customers():
    customer_id, _ = create_customer(
        "SA-006-AA",
        "2029-03-05T10:00:00Z",
        "2029-03-06T10:00:00Z",
        "Pesel",
        nationality="PL",
    )

    invalid = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(national_id_number="12345678901"),
    )
    assert invalid.status_code == 400
    assert "PESEL" in invalid.json()["detail"]

    valid = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(national_id_number=make_pesel()),
    )
    assert valid.status_code == 200


def test_expired_licence_is_rejected():
    customer_id, _ = create_customer(
        "SA-006-AA", "2029-03-07T10:00:00Z", "2029-03-08T10:00:00Z", "Expired"
    )

    response = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(driving_license_expires_at="2020-01-01"),
    )

    assert response.status_code == 400
    assert "expired" in response.json()["detail"]


def test_id_number_requires_a_document_type():
    customer_id, _ = create_customer(
        "SA-006-AA", "2029-03-09T10:00:00Z", "2029-03-10T10:00:00Z", "DocType"
    )

    response = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(id_document_type=None),
    )

    assert response.status_code == 400
    assert "document type" in response.json()["detail"]


def test_licence_must_be_valid_until_the_rental_ends():
    # The rental ends well after the licence does.
    customer_id, reservation_id = create_customer(
        "SA-006-AA", "2035-05-01T10:00:00Z", "2035-05-10T10:00:00Z", "ShortLicence"
    )

    saved = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(driving_license_expires_at=future(30)),
    )
    assert saved.status_code == 200

    without_rental = client.get(f"/api/customers/{customer_id}/identity-details")
    assert without_rental.json()["problem"] is None

    for_rental = client.get(
        f"/api/customers/{customer_id}/identity-details",
        params={"reservation_id": reservation_id},
    )
    assert for_rental.status_code == 200
    assert "expires before the rental ends" in for_rental.json()["problem"]


def test_getting_details_is_audited_and_incomplete_customers_report_a_problem():
    customer_id, _ = create_customer(
        "SA-006-AA", "2029-03-11T10:00:00Z", "2029-03-12T10:00:00Z", "View"
    )

    response = client.get(f"/api/customers/{customer_id}/identity-details")

    assert response.status_code == 200
    assert response.json()["national_id_number"] is None
    assert response.json()["problem"] is not None
    assert len(audit_rows(customer_id, "customer.identity_details_viewed")) == 1


def test_identity_details_404_for_unknown_customer():
    assert (
        client.get(f"/api/customers/{uuid4()}/identity-details").status_code == 404
    )
    assert (
        client.put(
            f"/api/customers/{uuid4()}/identity-details", json=details_payload()
        ).status_code
        == 404
    )


def test_agreement_needs_manual_identity_details_then_succeeds():
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-05-10T10:00:00Z", "2027-05-11T10:00:00Z"
    )
    reservation_id = reservation["id"]
    customer_id = reservation["customer"]["id"]

    client.post(f"/api/reservations/{reservation_id}/handover/confirm-cash-payment")
    client.post(
        f"/api/reservations/{reservation_id}/handover/signature",
        json={"signature_image": TINY_SIGNATURE},
    )
    _employee_sign(reservation_id)

    try:
        blocked = client.post(f"/api/reservations/{reservation_id}/handover/agreement")
        assert blocked.status_code == 400
        assert "Identity check incomplete" in blocked.json()["detail"]

        saved = client.put(
            f"/api/customers/{customer_id}/identity-details",
            params={"reservation_id": reservation_id},
            json=details_payload(),
        )
        assert saved.status_code == 200
        assert saved.json()["problem"] is None

        agreement = client.post(
            f"/api/reservations/{reservation_id}/handover/agreement"
        )
        assert agreement.status_code == 200
        assert agreement.json()["has_agreement"] is True
    finally:
        finish_rental(reservation_id)
        client.patch(f"/api/reservations/{reservation_id}/cancel")
        _reset_identity_verification(customer_id)


def test_legacy_stripe_verified_customers_still_pass_the_identity_check():
    db = SessionLocal()
    reservation = create_confirmed_reservation(
        "SA-008-AA", "2027-05-12T10:00:00Z", "2027-05-13T10:00:00Z"
    )
    customer_id = reservation["customer"]["id"]

    try:
        customer = db.get(Customer, UUID(customer_id))
        customer.identity_verification_status = "verified"
        db.commit()

        details = client.get(
            f"/api/customers/{customer_id}/identity-details",
            params={"reservation_id": reservation["id"]},
        ).json()

        assert details["legacy_stripe_verified"] is True
        assert details["problem"] is None
    finally:
        db.close()
        client.patch(f"/api/reservations/{reservation['id']}/cancel")
        _reset_identity_verification(customer_id)


# --- country neutrality ----------------------------------------------------


def test_a_national_id_number_is_optional_when_an_id_document_number_is_given():
    customer_id, reservation_id = create_customer(
        "SA-006-AA", "2029-03-13T10:00:00Z", "2029-03-14T10:00:00Z", "NoNationalId"
    )

    response = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(national_id_number="   "),
        params={"reservation_id": reservation_id},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["national_id_number"] is None
    assert body["id_document_number"] == "P-99887766"
    assert body["problem"] is None


def test_some_kind_of_id_number_is_still_required():
    customer_id, _ = create_customer(
        "SA-006-AA", "2029-03-15T10:00:00Z", "2029-03-16T10:00:00Z", "NoIdAtAll"
    )

    response = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(
            national_id_number=None,
            id_document_type=None,
            id_document_number=None,
            id_document_expires_at=None,
        ),
    )

    assert response.status_code == 400
    assert "ID number" in response.json()["detail"]
    assert "PESEL" not in response.json()["detail"]


def test_the_pesel_rule_only_applies_when_a_polish_customer_enters_one():
    customer_id, _ = create_customer(
        "SA-006-AA",
        "2029-03-17T10:00:00Z",
        "2029-03-18T10:00:00Z",
        "PlPassportOnly",
        nationality="PL",
    )

    without_number = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(national_id_number=None),
    )
    assert without_number.status_code == 200

    # Entering a number that is not a PESEL is still refused for a Pole.
    wrong = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(national_id_number="12345678901"),
    )
    assert wrong.status_code == 400


def test_a_non_polish_customers_number_is_not_checked_as_a_pesel():
    customer_id, _ = create_customer(
        "SA-006-AA",
        "2029-03-19T10:00:00Z",
        "2029-03-20T10:00:00Z",
        "NotPolish",
        nationality="GB",
    )

    response = client.put(
        f"/api/customers/{customer_id}/identity-details",
        json=details_payload(national_id_number="QQ 12 34 56 C"),
    )

    assert response.status_code == 200
    assert response.json()["national_id_number"] == "QQ123456C"
