"""
Bad input is refused with a message next to the field, never a server error:
the limits are the database's, so anything past them used to reach the
database and come back as a 500.
"""

from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import DataError, IntegrityError

from app.error_handlers import install_error_handlers
from app.main import app
from app.schemas.user import MAX_PASSWORD_BYTES
from app.services.auth import verify_password, hash_password
from tests.test_customers import create_reservation_with_customer
from tests.test_reservations import ensure_car_available, get_location_id

client = TestClient(app)

CUSTOMER = {
    "first_name": "Valid",
    "last_name": "Person",
    "date_of_birth": "1992-03-03",
    "address": "1 Test Street",
    "postal_code": "00100",
    "phone_number": "+31600000099",
    "email": "valid.person@example.com",
}


def _book(customer: dict):
    return client.post(
        "/api/reservations",
        json={
            "customer": customer,
            "car_id": ensure_car_available("SA-008-AA")["id"],
            "pickup_location_id": get_location_id("AHO"),
            "return_location_id": get_location_id("AHO"),
            "pickup_at": "2028-02-01T10:00:00Z",
            "return_at": "2028-02-03T10:00:00Z",
        },
    )


def _fields(response) -> set[str]:
    return {error["field"] for error in response.json()["errors"]}


def test_a_country_name_instead_of_a_code_is_a_message_not_a_server_error():
    response = _book({**CUSTOMER, "nationality": "Italy"})

    assert response.status_code == 422
    assert "customer.nationality" in _fields(response)


def test_a_country_code_is_stored_in_capitals():
    response = _book({**CUSTOMER, "nationality": " it "})

    assert response.status_code == 201
    assert response.json()["customer"]["nationality"] == "IT"

    client.patch(f"/api/reservations/{response.json()['id']}/cancel")


def test_values_longer_than_the_columns_are_refused_with_a_message():
    for field, too_long in (
        ("first_name", "x" * 101),
        ("last_name", "x" * 101),
        ("address", "x" * 256),
        ("postal_code", "x" * 21),
        ("phone_number", "1" * 31),
    ):
        response = _book({**CUSTOMER, field: too_long})

        assert response.status_code == 422, field
        assert f"customer.{field}" in _fields(response)


def test_an_email_has_to_look_like_one():
    response = _book({**CUSTOMER, "email": "not-an-email"})

    assert response.status_code == 422
    assert "customer.email" in _fields(response)


def test_a_required_customer_field_cannot_be_cleared_by_sending_null():
    reservation = create_reservation_with_customer(
        ensure_car_available("SA-008-AA")["id"],
        get_location_id("AHO"),
        "2028-02-10T10:00:00Z",
        "2028-02-12T10:00:00Z",
        {**CUSTOMER, "email": "clear.me@example.com", "first_name": "Clear"},
    )

    try:
        for field in ("first_name", "last_name", "address", "postal_code", "date_of_birth"):
            response = client.patch(
                f"/api/customers/{reservation['customer_id']}", json={field: None}
            )

            assert response.status_code == 422, field

        # Left out entirely still means unchanged.
        unchanged = client.patch(
            f"/api/customers/{reservation['customer_id']}", json={"address": "2 New Street"}
        )

        assert unchanged.status_code == 200
        assert unchanged.json()["first_name"] == "Clear"
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_password_longer_than_bcrypt_reads_is_refused_not_a_server_error():
    too_long = "a" * (MAX_PASSWORD_BYTES + 1)

    created = client.post(
        "/api/users",
        json={"email": f"long-{uuid4()}@example.com", "password": too_long, "role": "staff"},
    )

    assert created.status_code == 422
    assert created.json()["errors"][0]["code"] == "validation.password_too_long"

    # Counted in bytes: 40 two-byte letters is 80 bytes.
    accented = client.post(
        "/api/users",
        json={"email": f"accent-{uuid4()}@example.com", "password": "é" * 40, "role": "staff"},
    )

    assert accented.status_code == 422

    exactly_enough = "a" * MAX_PASSWORD_BYTES
    assert verify_password(exactly_enough, hash_password(exactly_enough)) is True


def test_logging_in_with_an_overlong_password_is_just_the_wrong_password():
    response = client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "a" * 500},
    )

    assert response.status_code == 401
    assert verify_password("a" * 500, hash_password("something else")) is False


def test_a_value_the_database_refuses_comes_back_as_a_message():
    # The net under the schemas: whatever a schema missed must not be a bare 500.
    net = FastAPI()
    install_error_handlers(net)

    @net.get("/integrity")
    def integrity():
        raise IntegrityError("INSERT", {}, Exception("duplicate key"))

    @net.get("/data")
    def data():
        raise DataError("INSERT", {}, Exception("value too long"))

    probe = TestClient(net)

    conflict = probe.get("/integrity")
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "database.rejected"

    refused = probe.get("/data")
    assert refused.status_code == 400
    assert refused.json()["code"] == "database.rejected"
