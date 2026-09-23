import random
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.dependencies import get_current_user
from app.main import app
from app.models import User
from tests.test_handovers import create_confirmed_reservation
from tests.test_reservations import (
    ensure_car_available,
    force_reservation_status,
    get_location_id,
)


client = TestClient(app)


def test_revenue_rejects_staff_role():
    staff_user = User(
        id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
        email="test-suite@example.com",
        hashed_password="unused",
        role="staff",
        is_active=True,
    )

    app.dependency_overrides[get_current_user] = lambda: staff_user

    try:
        response = client.get(
            "/api/dashboard/revenue",
            params={"start_date": "2026-07-28", "end_date": "2026-08-08"},
        )

        assert response.status_code == 403
    finally:
        # Restored by conftest's own override_auth fixture on the next
        # test anyway, but leave no trace within this test.
        app.dependency_overrides.pop(get_current_user, None)


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


def _random_dates(days: int = 2) -> tuple[str, str]:
    offset_days = random.randint(3000, 8000)
    pickup = datetime.now(timezone.utc) + timedelta(days=offset_days)
    return_at = pickup + timedelta(days=days)

    return (
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        return_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _today_revenue() -> dict:
    today = datetime.now(timezone.utc).date().isoformat()

    return client.get(
        "/api/dashboard/revenue",
        params={"start_date": today, "end_date": today},
    ).json()


def test_collected_revenue_includes_cash_payment_by_method():
    # Money collected is attributed to paid_at (today, since the payment
    # happens now), not the reservation's own pickup date -- unlike the
    # unrelated points/total_revenue field, which is why this doesn't
    # need a far-future pickup date to isolate itself.
    pickup_at, return_at = _random_dates()
    reservation = create_confirmed_reservation("SA-008-AA", pickup_at, return_at)

    before = _today_revenue()

    payment_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
    )
    assert payment_response.status_code == 200
    amount = payment_response.json()["payment_amount"]

    after = _today_revenue()

    assert after["total_collected"] == round(before["total_collected"] + amount, 2)
    assert after["collected_by_method"]["cash"] == round(
        before["collected_by_method"]["cash"] + amount, 2
    )
    assert after["collected_by_method"]["card"] == before["collected_by_method"]["card"]

    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_collected_revenue_excludes_refunded_payment():
    pickup_at, return_at = _random_dates()
    reservation = create_confirmed_reservation("SA-008-AA", pickup_at, return_at)

    payment_response = client.post(
        f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
    )
    amount = payment_response.json()["payment_amount"]

    with_payment = _today_revenue()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    after_refund = _today_revenue()

    # The refunded handover moved out of SUCCEEDED, so it no longer
    # counts toward collected revenue -- no separate subtraction logic
    # needed on the backend, just confirming it here.
    assert after_refund["total_collected"] == round(
        with_payment["total_collected"] - amount, 2
    )
    assert after_refund["total_refunded"] >= amount
