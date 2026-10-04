"""
Vehicles joining and leaving the fleet: added by admins only, never deleted, and
a retired car disappears from every current-fleet view while its history stays.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, Car, MaintenanceTask, Reservation, ReservationExtra
from tests._dates import far_future_days
from tests.test_reservations import create_reservation, get_location_id

client = TestClient(app)

_created: list[str] = []


def _plate() -> str:
    return f"ZZ-{uuid4().hex[:5].upper()}"


def _new_car(**overrides):
    payload = {
        "make": "Fiat",
        "model": "Panda",
        "year": 2024,
        "license_plate": _plate(),
        "category": "ECONOMY",
        "transmission": "MANUAL",
        "fuel_type": "PETROL",
        "seats": 4,
        "price_per_day": "39.00",
        "home_location_id": get_location_id("AHO"),
        **overrides,
    }

    response = client.post("/api/admin/cars", json=payload)

    if response.status_code == 201:
        _created.append(response.json()["id"])

    return response


@pytest.fixture(autouse=True)
def _cleanup():
    yield

    db = SessionLocal()
    try:
        for car_id in _created:
            for entry in db.scalars(select(AuditLog).where(AuditLog.entity_id == UUID(car_id))):
                db.delete(entry)

            # What the tests booked or scheduled on it (never paid, so there is
            # nothing else hanging off these reservations).
            for reservation in db.scalars(select(Reservation).where(Reservation.car_id == UUID(car_id))):
                for line in db.scalars(select(ReservationExtra).where(ReservationExtra.reservation_id == reservation.id)):
                    db.delete(line)
                db.delete(reservation)
            for task in db.scalars(select(MaintenanceTask).where(MaintenanceTask.car_id == UUID(car_id))):
                db.delete(task)
            db.flush()

            car = db.get(Car, UUID(car_id))
            if car is not None:
                db.delete(car)
        db.commit()
    finally:
        db.close()
        _created.clear()


def _listed_plates(**params) -> set[str]:
    return {car["license_plate"] for car in client.get("/api/cars", params=params).json()}


def _actions(car_id: str) -> list[str]:
    db = SessionLocal()
    try:
        return [e.action for e in db.scalars(select(AuditLog).where(AuditLog.entity_id == UUID(car_id)).order_by(AuditLog.created_at))]
    finally:
        db.close()


# --- adding ----------------------------------------------------------------------------------


def test_an_admin_adds_a_car_that_starts_available_at_its_home_location_and_is_audited():
    response = _new_car(license_plate="  zz  test 1 ")

    assert response.status_code == 201
    car = response.json()

    # Plates are stored the way they are printed: capitals, single spaces.
    assert car["license_plate"] == "ZZ TEST 1"
    assert car["status"] == "AVAILABLE"
    assert car["current_location"]["id"] == car["home_location"]["id"]
    assert car["is_retired"] is False
    # Not on the storefront until staff say so.
    assert car["offered_online"] is False
    assert "car.created" in _actions(car["id"])
    assert car["license_plate"] in _listed_plates()


def test_a_plate_already_in_the_fleet_is_refused_however_it_is_typed():
    first = _new_car(license_plate="ZZ DUP 1").json()

    again = _new_car(license_plate="zz dup 1")

    assert again.status_code == 400
    assert again.json()["code"] == "car.license_plate_already_use"
    assert first["license_plate"] == "ZZ DUP 1"


@pytest.mark.parametrize(
    ("override", "code"),
    [
        ({"category": "SPACESHIP"}, "car.invalid_category_value"),
        ({"transmission": "CVT"}, "car.invalid_transmission_value"),
        ({"fuel_type": "COAL"}, "car.invalid_fuel_type_value"),
        ({"home_location_id": str(uuid4())}, "location.not_found"),
    ],
)
def test_unknown_choices_are_refused_with_a_message(override, code):
    response = _new_car(**override)

    assert response.status_code == 400
    assert response.json()["code"] == code


@pytest.mark.parametrize(
    "override",
    [{"price_per_day": "-1"}, {"year": 1900}, {"seats": 0}, {"make": ""}, {"mileage": -5}, {"status": "RENTED"}],
)
def test_nonsense_input_is_a_validation_error_not_a_server_error(override):
    assert _new_car(**override).status_code == 422


def test_only_admins_can_add_or_retire_cars():
    app.dependency_overrides[get_current_user] = lambda: type(
        "Staff", (), {"id": UUID(int=0), "role": "staff", "is_active": True, "email": "s@example.com", "token_valid_after": None}
    )()

    try:
        assert _new_car().status_code == 403
        assert client.post(f"/api/admin/cars/{uuid4()}/retire").status_code == 403
        assert client.post(f"/api/admin/cars/{uuid4()}/reactivate").status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# --- retiring --------------------------------------------------------------------------------


def test_a_retired_car_leaves_every_current_fleet_view_but_keeps_its_history():
    car = _new_car().json()
    plate = car["license_plate"]

    retired = client.post(f"/api/admin/cars/{car['id']}/retire")

    assert retired.status_code == 200
    assert retired.json()["is_retired"] is True
    assert retired.json()["retired_at"] is not None
    assert plate not in _listed_plates()
    assert plate in _listed_plates(include_retired="true")
    # Still there to open from an old reservation or invoice.
    assert client.get(f"/api/cars/{car['id']}").status_code == 200
    assert _actions(car["id"]) == ["car.created", "car.retired"]

    # Not offered for a new rental at its location.
    location = car["home_location"]["id"]
    start = datetime.now(timezone.utc) + timedelta(days=far_future_days())
    available = client.get(
        "/api/cars/available",
        params={"location_id": location, "pickup_at": start.isoformat(), "return_at": (start + timedelta(days=2)).isoformat()},
    ).json()
    assert car["id"] not in {item["id"] for item in available}


def test_a_retired_car_cannot_be_booked():
    car = _new_car().json()
    client.post(f"/api/admin/cars/{car['id']}/retire")
    start = datetime.now(timezone.utc) + timedelta(days=far_future_days())

    response = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Retired",
                "last_name": "Booker",
                "date_of_birth": "1990-01-01",
                "address": "1 Test Street",
                "postal_code": "00100",
                "phone_number": "+31600000077",
                "email": "retired.booker@example.com",
            },
            "car_id": car["id"],
            "pickup_location_id": car["home_location"]["id"],
            "return_location_id": car["home_location"]["id"],
            "pickup_at": start.isoformat(),
            "return_at": (start + timedelta(days=2)).isoformat(),
        },
    )

    assert response.status_code == 400
    assert response.json()["code"] == "car.retired"


def test_a_car_with_a_booking_that_has_not_ended_cannot_be_retired():
    car = _new_car().json()
    start = datetime.now(timezone.utc) + timedelta(days=far_future_days())
    reservation = create_reservation(
        car["id"],
        car["home_location"]["id"],
        start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (start + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )

    try:
        refused = client.post(f"/api/admin/cars/{car['id']}/retire")

        assert refused.status_code == 400
        assert refused.json()["code"] == "car.retire_has_bookings"
        assert refused.json()["params"]["bookings"] == 1
        assert car["license_plate"] in _listed_plates()
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

    # With the booking cancelled it can go. Its history stays pointing at it.
    assert client.post(f"/api/admin/cars/{car['id']}/retire").status_code == 200
    assert client.get(f"/api/reservations/{reservation['id']}").json()["car"]["id"] == car["id"]


def test_a_car_with_open_maintenance_cannot_be_retired():
    car = _new_car().json()
    start = datetime.now(timezone.utc) + timedelta(days=1)
    task = client.post(
        "/api/maintenance/tasks",
        json={
            "car_id": car["id"],
            "task_type": "CLEANING",
            "notes": None,
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(hours=2)).isoformat(),
        },
    )
    assert task.status_code == 200

    refused = client.post(f"/api/admin/cars/{car['id']}/retire")

    assert refused.status_code == 400
    assert refused.json()["code"] == "car.retire_has_maintenance"

    client.patch(f"/api/maintenance/tasks/{task.json()['id']}/cancel")

    assert client.post(f"/api/admin/cars/{car['id']}/retire").status_code == 200


def test_retiring_twice_or_an_unknown_car_is_a_clear_error():
    car = _new_car().json()
    assert client.post(f"/api/admin/cars/{car['id']}/retire").status_code == 200

    twice = client.post(f"/api/admin/cars/{car['id']}/retire")
    assert twice.status_code == 400
    assert twice.json()["code"] == "car.already_retired"

    assert client.post(f"/api/admin/cars/{uuid4()}/retire").status_code == 404


def test_a_retired_car_can_be_put_back_but_stays_off_the_storefront():
    car = _new_car(offered_online=True).json()
    client.post(f"/api/admin/cars/{car['id']}/retire")

    back = client.post(f"/api/admin/cars/{car['id']}/reactivate")

    assert back.status_code == 200
    assert back.json()["is_retired"] is False
    assert back.json()["offered_online"] is False
    assert car["license_plate"] in _listed_plates()
    assert _actions(car["id"]) == ["car.created", "car.retired", "car.reactivated"]

    again = client.post(f"/api/admin/cars/{car['id']}/reactivate")
    assert again.status_code == 400
    assert again.json()["code"] == "car.not_retired"


def test_a_retired_car_is_left_out_of_the_fleet_reports():
    car = _new_car().json()
    plate = car["license_plate"]

    def mentioned() -> bool:
        return any(
            plate in str(client.get(path).json())
            for path in ("/api/fleet-condition", "/api/notifications", "/api/dashboard/fleet-by-location")
        )

    # Insurance and inspection dates make a car show up in these.
    client.patch(
        f"/api/cars/{car['id']}",
        json={"insured_until": (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()},
    )
    assert mentioned()

    client.post(f"/api/admin/cars/{car['id']}/retire")

    assert not mentioned()
