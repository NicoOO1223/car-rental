from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    force_reservation_status,
    get_location_id,
)


client = TestClient(app)


def get_car_id_by_plate(plate: str) -> str:
    cars = client.get("/api/cars").json()

    return next(
        car["id"]
        for car in cars
        if car["license_plate"] == plate
    )


def test_get_cars():
    response = client.get("/api/cars")

    assert response.status_code == 200

    cars = response.json()

    assert len(cars) == 10


def test_update_car_happy_path():
    car_id = get_car_id_by_plate("SA-005-AA")

    original = client.get(f"/api/cars/{car_id}").json()

    response = client.patch(
        f"/api/cars/{car_id}",
        json={
            "price_per_day": "77.00",
            "category": "MIDSIZE",
        },
    )

    assert response.status_code == 200

    updated = response.json()

    assert updated["price_per_day"] == "77.00"
    assert updated["category"] == "MIDSIZE"

    # Restore original values so the seeded fixture stays clean
    # for other tests / future runs against this dev database.
    client.patch(
        f"/api/cars/{car_id}",
        json={
            "price_per_day": original["price_per_day"],
            "category": original["category"],
        },
    )


def test_update_car_not_found():
    response = client.patch(
        f"/api/cars/{uuid4()}",
        json={"category": "SUV"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Car not found."


def test_update_car_duplicate_license_plate():
    car_id = get_car_id_by_plate("SA-005-AA")

    response = client.patch(
        f"/api/cars/{car_id}",
        json={"license_plate": "SA-001-AA"},
    )

    assert response.status_code == 400


def test_update_car_invalid_status():
    car_id = get_car_id_by_plate("SA-005-AA")

    response = client.patch(
        f"/api/cars/{car_id}",
        json={"status": "SCRAPPED"},
    )

    assert response.status_code == 400


def test_update_car_invalid_location():
    car_id = get_car_id_by_plate("SA-005-AA")

    response = client.patch(
        f"/api/cars/{car_id}",
        json={"current_location_id": str(uuid4())},
    )

    assert response.status_code == 400


def test_status_by_date_confirmed_reservation_shows_reserved():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation(
        car["id"], aho_id, "2029-01-10T10:00:00Z", "2029-01-15T10:00:00Z"
    )
    approve = client.patch(
        f"/api/reservations/{reservation['id']}/status",
        json={"status": "CONFIRMED"},
    )
    assert approve.status_code == 200

    overlapping = client.get(
        "/api/cars/status-by-date", params={"date": "2029-01-12"}
    )
    assert overlapping.status_code == 200
    assert overlapping.json()[car["id"]] == "RESERVED"

    # Outside the reservation window, the same car reads as available.
    outside = client.get(
        "/api/cars/status-by-date", params={"date": "2029-01-20"}
    )
    assert outside.json()[car["id"]] == "AVAILABLE"

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_status_by_date_active_reservation_shows_rented():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation(
        car["id"], aho_id, "2029-02-10T10:00:00Z", "2029-02-15T10:00:00Z"
    )
    # ACTIVE is only reachable via the real handover flow now — jump
    # straight there since this test is about the status query, not how
    # ACTIVE was reached.
    force_reservation_status(reservation["id"], "ACTIVE")

    response = client.get(
        "/api/cars/status-by-date", params={"date": "2029-02-12"}
    )
    assert response.json()[car["id"]] == "RENTED"

    force_reservation_status(reservation["id"], "CANCELLED")


def test_status_by_date_pending_reservation_still_shows_available():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    # create_reservation leaves the reservation PENDING (not yet approved).
    reservation = create_reservation(
        car["id"], aho_id, "2029-03-10T10:00:00Z", "2029-03-15T10:00:00Z"
    )

    response = client.get(
        "/api/cars/status-by-date", params={"date": "2029-03-12"}
    )
    # Unlike the dashboard's fleet-status endpoint, a still-pending request
    # must not make the car read as booked on the fleet overview.
    assert response.json()[car["id"]] == "AVAILABLE"

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_status_by_date_carries_through_maintenance():
    car_id = get_car_id_by_plate("SA-005-AA")
    original = client.get(f"/api/cars/{car_id}").json()["status"]

    client.patch(f"/api/cars/{car_id}", json={"status": "MAINTENANCE"})

    response = client.get(
        "/api/cars/status-by-date", params={"date": "2029-04-01"}
    )
    assert response.json()[car_id] == "MAINTENANCE"

    client.patch(f"/api/cars/{car_id}", json={"status": original})