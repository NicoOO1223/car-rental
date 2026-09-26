import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog, Location
from tests.test_configuration import _as_staff, _restore_admin_override

client = TestClient(app)


def _code() -> str:
    return "T" + uuid.uuid4().hex[:6].upper()


@pytest.fixture
def created():
    """Creates locations through the API; deletes them afterwards (tests
    only: the API itself never deletes a location)."""

    made: list[str] = []

    def make(**overrides):
        payload = {"name": "Test Depot", "airport_code": _code()}
        payload.update(overrides)
        response = client.post("/api/locations", json=payload)
        if response.status_code == 201:
            made.append(response.json()["id"])
        return response

    yield make

    db = SessionLocal()
    for location_id in made:
        for entry in db.scalars(select(AuditLog).where(AuditLog.entity_id == uuid.UUID(location_id))):
            db.delete(entry)
        location = db.get(Location, uuid.UUID(location_id))
        if location is not None:
            db.delete(location)
    db.commit()
    db.close()


def test_list_includes_timezone_and_active_flag():
    rows = client.get("/api/locations").json()

    assert rows
    assert all({"timezone", "is_active"} <= set(row) for row in rows)
    assert all(row["is_active"] for row in rows)


def test_create_normalizes_and_defaults_the_timezone(created):
    business_zone = client.get("/api/configuration").json()["timezone"]

    response = created(airport_code=" ab12 ", name="  Depot  ", address="  ")

    assert response.status_code == 201
    body = response.json()
    assert body["airport_code"] == "AB12"
    assert body["name"] == "Depot"
    assert body["address"] is None
    assert body["timezone"] == business_zone
    assert body["is_active"] is True


def test_create_with_its_own_timezone(created):
    response = created(timezone="Pacific/Auckland")

    assert response.status_code == 201
    assert response.json()["timezone"] == "Pacific/Auckland"


def test_create_is_audited(created):
    location = created().json()

    db = SessionLocal()
    entry = db.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == uuid.UUID(location["id"]),
            AuditLog.action == "location.created",
        )
    )
    db.close()

    assert entry is not None
    assert entry.details["airport_code"] == location["airport_code"]


def test_duplicate_code_is_refused(created):
    first = created().json()

    response = created(airport_code=first["airport_code"].lower())

    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"airport_code": "X"},
        {"airport_code": "A B"},
        {"airport_code": "ABCDEFGHIJK"},
        {"name": "   "},
        {"timezone": "Mars/Base"},
    ],
)
def test_invalid_create_is_rejected(payload, created):
    assert created(**payload).status_code == 422


def test_staff_can_read_but_not_change_locations(created):
    location = created().json()
    _as_staff()

    try:
        assert client.get("/api/locations").status_code == 200
        assert client.post("/api/locations", json={"name": "X", "airport_code": "XX1"}).status_code == 403
        assert client.patch(f"/api/locations/{location['id']}", json={"name": "Y"}).status_code == 403
    finally:
        _restore_admin_override()


def test_update_changes_fields_and_is_audited(created):
    location = created(address="Old street").json()

    response = client.patch(
        f"/api/locations/{location['id']}",
        json={"name": "New name", "timezone": "Europe/Rome", "address": ""},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New name"
    assert body["timezone"] == "Europe/Rome"
    assert body["address"] is None

    db = SessionLocal()
    entry = db.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == uuid.UUID(location["id"]),
            AuditLog.action == "location.updated",
        )
    )
    db.close()

    assert entry.details["timezone"]["new"] == "Europe/Rome"


def test_update_cannot_take_another_locations_code(created):
    first = created().json()
    second = created().json()

    response = client.patch(
        f"/api/locations/{second['id']}", json={"airport_code": first["airport_code"]}
    )

    assert response.status_code == 400


def test_update_unknown_location_is_404():
    assert client.patch(f"/api/locations/{uuid.uuid4()}", json={"name": "X"}).status_code == 404


def test_deactivating_hides_the_location_from_the_default_list(created):
    location = created().json()

    response = client.patch(f"/api/locations/{location['id']}", json={"is_active": False})
    assert response.status_code == 200

    active_ids = {row["id"] for row in client.get("/api/locations").json()}
    all_ids = {row["id"] for row in client.get("/api/locations", params={"include_inactive": True}).json()}

    assert location["id"] not in active_ids
    assert location["id"] in all_ids

    # And it can come back.
    assert client.patch(f"/api/locations/{location['id']}", json={"is_active": True}).status_code == 200
    assert location["id"] in {row["id"] for row in client.get("/api/locations").json()}


def test_a_location_with_vehicles_cannot_be_deactivated():
    olb = next(row for row in client.get("/api/locations").json() if row["airport_code"] == "OLB")

    response = client.patch(f"/api/locations/{olb['id']}", json={"is_active": False})

    assert response.status_code == 400
    assert "still in use" in response.json()["detail"]
    assert client.get("/api/locations").json()  # nothing changed
    assert any(
        row["id"] == olb["id"] and row["is_active"] for row in client.get("/api/locations").json()
    )


def test_new_bookings_cannot_use_an_inactive_location(created):
    location = created().json()
    client.patch(f"/api/locations/{location['id']}", json={"is_active": False})

    car = client.get("/api/cars").json()[0]
    pickup = datetime.now(timezone.utc) + timedelta(days=9100)

    response = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Test",
                "last_name": "User",
                "date_of_birth": "1995-01-01",
                "address": "Test Street 1",
                "postal_code": "1000AA",
                "phone_number": "+31600000000",
                "email": "test.user@example.com",
            },
            "car_id": car["id"],
            "pickup_location_id": location["id"],
            "return_location_id": car["current_location"]["id"],
            "pickup_at": pickup.isoformat(),
            "return_at": (pickup + timedelta(days=2)).isoformat(),
        },
    )

    assert response.status_code == 400
    assert "no longer in use" in response.json()["detail"]
