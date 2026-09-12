import random
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import (
    ensure_car_available,
    force_reservation_status,
    get_location_id,
)


client = TestClient(app)


def test_revenue_known_seed_completed_reservation():
    # Marco Rossi's SA-001-AA reservation (seed.py) is COMPLETED,
    # 2026-08-01 -> 2026-08-05 (4 days) at 45.00/day = 180.00,
    # attributed to its pickup date.
    response = client.get(
        "/api/dashboard/revenue",
        params={"start_date": "2026-07-28", "end_date": "2026-08-08"},
    )

    assert response.status_code == 200

    body = response.json()

    points_by_date = {p["date"]: p["revenue"] for p in body["points"]}

    assert points_by_date["2026-08-01"] == 180.0
    assert points_by_date["2026-07-31"] == 0.0
    assert points_by_date["2026-08-02"] == 0.0
    assert body["total_revenue"] == 180.0


def test_revenue_fresh_completed_reservation_is_attributed_to_pickup_date():
    # Use a pseudo-random far-future date so this reservation's revenue
    # lands on a day no other test (or previous run of this test) has
    # ever touched -- this test suite has no fixtures/rollback, and a
    # COMPLETED reservation can never be cancelled/removed afterward,
    # so a fixed date would accumulate revenue across repeated runs.
    offset_days = random.randint(3000, 8000)
    pickup_date = (
        datetime.now(timezone.utc).date() + timedelta(days=offset_days)
    )
    return_date = pickup_date + timedelta(days=2)

    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")  # 42.00/day (Fiat Panda)

    response = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Revenue",
                "last_name": "Test",
                "date_of_birth": "1995-01-01",
                "address": "Test Street 1",
                "postal_code": "1000AA",
                "phone_number": "+31600000000",
                "email": "revenue.test@example.com",
            },
            "car_id": car["id"],
            "pickup_location_id": aho_id,
            "return_location_id": aho_id,
            "pickup_at": f"{pickup_date.isoformat()}T10:00:00Z",
            "return_at": f"{return_date.isoformat()}T10:00:00Z",
        },
    )

    assert response.status_code == 201
    reservation = response.json()

    # ACTIVE is only reachable via the handover flow now — jump straight
    # to COMPLETED since this test only cares about revenue attribution,
    # not how COMPLETED was reached.
    force_reservation_status(reservation["id"], "COMPLETED")

    revenue_response = client.get(
        "/api/dashboard/revenue",
        params={
            "start_date": pickup_date.isoformat(),
            "end_date": pickup_date.isoformat(),
        },
    )

    assert revenue_response.status_code == 200

    points = revenue_response.json()["points"]

    assert len(points) == 1
    assert points[0]["date"] == pickup_date.isoformat()
    assert points[0]["revenue"] == 84.0  # 42.00/day x 2 days


def test_revenue_excludes_non_completed_statuses():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    offset_days = random.randint(3000, 8000)
    pickup_date = (
        datetime.now(timezone.utc).date() + timedelta(days=offset_days)
    )
    return_date = pickup_date + timedelta(days=1)

    response = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Not",
                "last_name": "Completed",
                "date_of_birth": "1995-01-01",
                "address": "Test Street 1",
                "postal_code": "1000AA",
                "phone_number": "+31600000000",
                "email": "not.completed@example.com",
            },
            "car_id": car["id"],
            "pickup_location_id": aho_id,
            "return_location_id": aho_id,
            "pickup_at": f"{pickup_date.isoformat()}T10:00:00Z",
            "return_at": f"{return_date.isoformat()}T10:00:00Z",
        },
    )

    assert response.status_code == 201
    reservation = response.json()

    # Still PENDING -- should not contribute any revenue.
    revenue_response = client.get(
        "/api/dashboard/revenue",
        params={
            "start_date": pickup_date.isoformat(),
            "end_date": pickup_date.isoformat(),
        },
    )

    assert revenue_response.json()["points"][0]["revenue"] == 0.0

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_revenue_defaults_to_last_30_days():
    response = client.get("/api/dashboard/revenue")

    assert response.status_code == 200

    body = response.json()
    today = datetime.now(timezone.utc).date()
    expected_start = today - timedelta(days=29)

    assert body["end_date"] == today.isoformat()
    assert body["start_date"] == expected_start.isoformat()
    assert len(body["points"]) == 30


def test_revenue_invalid_range_rejected():
    response = client.get(
        "/api/dashboard/revenue",
        params={"start_date": "2026-08-10", "end_date": "2026-08-01"},
    )

    assert response.status_code == 400
