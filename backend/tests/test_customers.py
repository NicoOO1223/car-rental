from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    get_location_id,
)


client = TestClient(app)


def create_reservation_with_customer(car_id, location_id, pickup_at, return_at, customer):
    response = client.post(
        "/api/reservations",
        json={
            "customer": customer,
            "car_id": car_id,
            "pickup_location_id": location_id,
            "return_location_id": location_id,
            "pickup_at": pickup_at,
            "return_at": return_at,
        },
    )

    assert response.status_code == 201

    return response.json()


# NOTE: `create_reservation()` (imported from test_reservations) posts a
# hardcoded, identical "Test User" customer payload every time it's
# called. Many existing tests across the suite already call it, so the
# dedup fix means all of those calls now converge onto a single shared
# "Test User" Customer row. That's safe — no existing test asserts
# anything about customer id or customer count.


def test_create_reservation_reuses_existing_customer():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    first = create_reservation(
        car["id"], aho_id, "2028-01-05T10:00:00Z", "2028-01-07T10:00:00Z"
    )
    second = create_reservation(
        car["id"], aho_id, "2028-01-10T10:00:00Z", "2028-01-12T10:00:00Z"
    )

    assert first["customer_id"] == second["customer_id"]

    client.patch(f"/api/reservations/{first['id']}/cancel")
    client.patch(f"/api/reservations/{second['id']}/cancel")


def test_create_reservation_dedup_is_case_insensitive_and_trimmed():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    baseline = create_reservation(
        car["id"], aho_id, "2028-02-01T10:00:00Z", "2028-02-03T10:00:00Z"
    )

    variant = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-02-05T10:00:00Z",
        "2028-02-07T10:00:00Z",
        {
            "first_name": " TEST ",
            "last_name": "uSeR",
            "date_of_birth": "1995-01-01",
            "address": " test street 1 ",
            "postal_code": "1000aa",
            "phone_number": "+31600000000",
            "email": "test.user@example.com",
        },
    )

    assert baseline["customer_id"] == variant["customer_id"]

    client.patch(f"/api/reservations/{baseline['id']}/cancel")
    client.patch(f"/api/reservations/{variant['id']}/cancel")


def test_create_reservation_distinct_customer_not_merged():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    baseline = create_reservation(
        car["id"], aho_id, "2028-03-01T10:00:00Z", "2028-03-03T10:00:00Z"
    )

    distinct = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-03-05T10:00:00Z",
        "2028-03-07T10:00:00Z",
        {
            "first_name": "Test",
            "last_name": "User",
            "date_of_birth": "1995-01-01",
            "address": "A Totally Different Street 99",
            "postal_code": "1000AA",
            "phone_number": "+31600000001",
            "email": "distinct.test.user@example.com",
        },
    )

    assert baseline["customer_id"] != distinct["customer_id"]

    client.patch(f"/api/reservations/{baseline['id']}/cancel")
    client.patch(f"/api/reservations/{distinct['id']}/cancel")


def test_get_customers_sorted_by_most_recent_reservation():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")
    suffix = uuid4().hex[:8]

    older = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-04-01T10:00:00Z",
        "2028-04-03T10:00:00Z",
        {
            "first_name": f"Older{suffix}",
            "last_name": "Sorter",
            "date_of_birth": "1990-01-01",
            "address": "Sort Street 1",
            "postal_code": "SORT1",
            "phone_number": "+31600000000",
            "email": f"older{suffix}@example.com",
        },
    )
    newer = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-04-05T10:00:00Z",
        "2028-04-07T10:00:00Z",
        {
            "first_name": f"Newer{suffix}",
            "last_name": "Sorter",
            "date_of_birth": "1990-01-01",
            "address": "Sort Street 2",
            "postal_code": "SORT2",
            "phone_number": "+31600000000",
            "email": f"newer{suffix}@example.com",
        },
    )

    customers = client.get("/api/customers").json()
    ids = [c["id"] for c in customers]

    assert ids.index(newer["customer_id"]) < ids.index(older["customer_id"])

    client.patch(f"/api/reservations/{older['id']}/cancel")
    client.patch(f"/api/reservations/{newer['id']}/cancel")


def test_get_customer_detail_and_reservations():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-05-01T10:00:00Z",
        "2028-05-03T10:00:00Z",
        {
            "first_name": "Detail",
            "last_name": "View",
            "date_of_birth": "1991-02-02",
            "address": "Detail Street 1",
            "postal_code": "DET01",
            "phone_number": "+31600000000",
            "email": "detail.view@example.com",
        },
    )
    customer_id = reservation["customer_id"]

    detail = client.get(f"/api/customers/{customer_id}")
    assert detail.status_code == 200
    assert detail.json()["first_name"] == "Detail"

    reservations = client.get(f"/api/customers/{customer_id}/reservations")
    assert reservations.status_code == 200
    assert any(r["id"] == reservation["id"] for r in reservations.json())

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_get_customer_not_found():
    response = client.get(f"/api/customers/{uuid4()}")
    assert response.status_code == 404


def test_update_customer_endpoint():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-06-01T10:00:00Z",
        "2028-06-03T10:00:00Z",
        {
            "first_name": "Update",
            "last_name": "Me",
            "date_of_birth": "1992-03-03",
            "address": "Original Address",
            "postal_code": "UPD01",
            "phone_number": "+31600000000",
            "email": "update.me@example.com",
        },
    )
    customer_id = reservation["customer_id"]

    customers_before = client.get("/api/customers").json()

    response = client.patch(
        f"/api/customers/{customer_id}",
        json={"address": "New Address"},
    )
    assert response.status_code == 200
    assert response.json()["address"] == "New Address"

    customers_after = client.get("/api/customers").json()
    assert len(customers_before) == len(customers_after)

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_update_customer_not_found():
    response = client.patch(
        f"/api/customers/{uuid4()}",
        json={"address": "Nowhere"},
    )
    assert response.status_code == 404


def test_create_reservation_requires_phone_and_email():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    response = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Missing",
                "last_name": "Contact",
                "date_of_birth": "1995-01-01",
                "address": "Test Street 1",
                "postal_code": "1000AA",
                # phone_number/email omitted on purpose.
            },
            "car_id": car["id"],
            "pickup_location_id": aho_id,
            "return_location_id": aho_id,
            "pickup_at": "2028-07-01T10:00:00Z",
            "return_at": "2028-07-03T10:00:00Z",
        },
    )

    assert response.status_code == 422


def test_create_reservation_stores_phone_and_email():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-07-05T10:00:00Z",
        "2028-07-07T10:00:00Z",
        {
            "first_name": "Contact",
            "last_name": "Info",
            "date_of_birth": "1993-04-04",
            "address": "Contact Street 1",
            "postal_code": "CON01",
            "phone_number": "+31612345678",
            "email": "contact.info@example.com",
        },
    )

    assert reservation["customer"]["phone_number"] == "+31612345678"
    assert reservation["customer"]["email"] == "contact.info@example.com"

    customer_id = reservation["customer_id"]
    detail = client.get(f"/api/customers/{customer_id}").json()
    assert detail["phone_number"] == "+31612345678"
    assert detail["email"] == "contact.info@example.com"

    list_item = next(
        c for c in client.get("/api/customers").json() if c["id"] == customer_id
    )
    assert list_item["phone_number"] == "+31612345678"
    assert list_item["email"] == "contact.info@example.com"

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_update_customer_phone_and_email():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-07-10T10:00:00Z",
        "2028-07-12T10:00:00Z",
        {
            "first_name": "Update",
            "last_name": "Contact",
            "date_of_birth": "1994-05-05",
            "address": "Update Street 1",
            "postal_code": "UPC01",
            "phone_number": "+31600000009",
            "email": "old.contact@example.com",
        },
    )
    customer_id = reservation["customer_id"]

    response = client.patch(
        f"/api/customers/{customer_id}",
        json={"phone_number": "+31699999999", "email": "new.contact@example.com"},
    )

    assert response.status_code == 200
    assert response.json()["phone_number"] == "+31699999999"
    assert response.json()["email"] == "new.contact@example.com"

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def _audit_rows_for_customer(customer_id: str, action: str):
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


def test_get_customer_detail_records_audit_log():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-07-01T10:00:00Z",
        "2028-07-03T10:00:00Z",
        {
            "first_name": "Audited",
            "last_name": "Lookup",
            "date_of_birth": "1993-04-04",
            "address": "Audit Street 1",
            "postal_code": "AUD01",
            "phone_number": "+31600000000",
            "email": "audited.lookup@example.com",
        },
    )
    customer_id = reservation["customer_id"]

    before = _audit_rows_for_customer(customer_id, "customer.viewed")
    assert before == []

    response = client.get(f"/api/customers/{customer_id}")
    assert response.status_code == 200

    after = _audit_rows_for_customer(customer_id, "customer.viewed")
    assert len(after) == 1

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_get_customers_list_does_not_record_audit_log():
    """
    The list endpoint is a routine, high-frequency screen load returning
    many customers at once — auditing every view would flood the table
    and bury the signal that the detail endpoint's audit entry provides.
    """
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation_with_customer(
        car["id"],
        aho_id,
        "2028-07-05T10:00:00Z",
        "2028-07-07T10:00:00Z",
        {
            "first_name": "Listed",
            "last_name": "Customer",
            "date_of_birth": "1993-05-05",
            "address": "List Street 1",
            "postal_code": "LST01",
            "phone_number": "+31600000000",
            "email": "listed.customer@example.com",
        },
    )
    customer_id = reservation["customer_id"]

    response = client.get("/api/customers")
    assert response.status_code == 200

    assert _audit_rows_for_customer(customer_id, "customer.viewed") == []

    client.patch(f"/api/reservations/{reservation['id']}/cancel")
