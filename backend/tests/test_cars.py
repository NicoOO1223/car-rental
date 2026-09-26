from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    force_reservation_status,
    get_car_status_raw,
    get_location_id,
    set_car_status,
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
            "category": "MIDSIZE",
        },
    )

    assert response.status_code == 200

    updated = response.json()

    assert updated["category"] == "MIDSIZE"

    # Restore original values so the seeded fixture stays clean
    # for other tests / future runs against this dev database.
    client.patch(
        f"/api/cars/{car_id}",
        json={
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


def test_update_car_rejects_manual_status_change():
    car_id = get_car_id_by_plate("SA-005-AA")
    before = get_car_status_raw(car_id)

    response = client.patch(
        f"/api/cars/{car_id}",
        json={"status": "MAINTENANCE"},
    )

    assert response.status_code == 422
    assert get_car_status_raw(car_id) == before


def test_update_car_invalid_location():
    car_id = get_car_id_by_plate("SA-005-AA")

    response = client.patch(
        f"/api/cars/{car_id}",
        json={"home_location_id": str(uuid4())},
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
    original = get_car_status_raw(car_id)

    set_car_status(car_id, "MAINTENANCE")

    response = client.get(
        "/api/cars/status-by-date", params={"date": "2029-04-01"}
    )
    assert response.json()[car_id] == "MAINTENANCE"

    set_car_status(car_id, original)

def test_daily_rates_returns_the_rounded_down_average_for_every_day():
    import math
    from datetime import date, timedelta

    from app.database import SessionLocal
    from app.models import Car

    location_id = client.get("/api/cars").json()[0]["current_location"]["id"]

    db = SessionLocal()
    try:
        prices = [
            float(car.price_per_day)
            for car in db.query(Car).filter(
                Car.current_location_id == location_id,
                Car.status == "AVAILABLE",
            )
        ]
    finally:
        db.close()

    assert prices, "test needs an available car at this location"
    expected = math.floor(sum(prices) / len(prices))

    start = date.today()
    end = start + timedelta(days=9)

    response = client.get(
        "/api/cars/daily-rates",
        params={
            "location_id": location_id,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        },
    )

    assert response.status_code == 200

    rates = response.json()
    assert [rate["date"] for rate in rates] == [
        (start + timedelta(days=offset)).isoformat() for offset in range(10)
    ]
    assert all(float(rate["price"]) == expected for rate in rates)


def test_daily_rates_rejects_bad_ranges():
    from datetime import date, timedelta

    location_id = client.get("/api/cars").json()[0]["current_location"]["id"]
    today = date.today()

    backwards = client.get(
        "/api/cars/daily-rates",
        params={
            "location_id": location_id,
            "start_date": today.isoformat(),
            "end_date": (today - timedelta(days=1)).isoformat(),
        },
    )
    assert backwards.status_code == 400

    too_long = client.get(
        "/api/cars/daily-rates",
        params={
            "location_id": location_id,
            "start_date": today.isoformat(),
            "end_date": (today + timedelta(days=1000)).isoformat(),
        },
    )
    assert too_long.status_code == 400


def test_fleet_reservations_returns_only_confirmed_and_active_with_car_ids():
    response = client.get("/api/cars/reservations")

    assert response.status_code == 200

    rows = response.json()
    assert all(row["status"] in ("CONFIRMED", "ACTIVE") for row in rows)
    assert all(row["car_id"] for row in rows)

    pickups = [row["pickup_at"] for row in rows]
    assert pickups == sorted(pickups)

    # Each row matches what the per-car endpoint reports for that car.
    if rows:
        car_id = rows[0]["car_id"]
        per_car = client.get(f"/api/cars/{car_id}/reservations").json()
        per_car_ids = {row["id"] for row in per_car}
        assert rows[0]["id"] in per_car_ids
