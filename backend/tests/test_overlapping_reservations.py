"""
GET /api/reservations/{id}/overlapping — what staff sees when reviewing a
PENDING reservation: every other reservation competing for the same car
and dates, ranked (see app/services/reservation_ranking.py).
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests._dates import far_future_days
from tests.test_reservations import create_reservation, ensure_car_available, get_location_id

client = TestClient(app)


def _window(days=2):
    pickup = datetime.now(timezone.utc) + timedelta(days=far_future_days())

    return pickup.isoformat(), (pickup + timedelta(days=days)).isoformat()


def test_two_overlapping_pending_requests_see_each_other():
    car = ensure_car_available("SA-004-AA")
    location_id = car["current_location"]["id"]
    pickup, dropoff = _window()

    first = create_reservation(car["id"], location_id, pickup, dropoff)
    second = create_reservation(car["id"], location_id, pickup, dropoff)

    try:
        response = client.get(f"/api/reservations/{first['id']}/overlapping")
        assert response.status_code == 200

        body = response.json()
        assert [item["id"] for item in body["items"]] == [second["id"]]
        assert body["items"][0]["status"] == "PENDING"
        # Ranking compares the whole group, including the one being viewed —
        # "first" asked first and is the real winner, even though it can't
        # appear in its own "items" list (the page already shows itself).
        assert body["suggested_id"] == first["id"]

        # It's symmetric: the second sees the first, not itself — and since
        # "first" is the actual winner, it's tagged suggested here too.
        other_way = client.get(f"/api/reservations/{second['id']}/overlapping").json()
        assert [item["id"] for item in other_way["items"]] == [first["id"]]
        assert other_way["suggested_id"] == first["id"]
    finally:
        client.patch(f"/api/reservations/{first['id']}/cancel")
        client.patch(f"/api/reservations/{second['id']}/cancel")


def test_a_reservation_with_nothing_overlapping_gets_an_empty_list():
    car = ensure_car_available("SA-004-AA")
    location_id = car["current_location"]["id"]
    pickup, dropoff = _window()

    alone = create_reservation(car["id"], location_id, pickup, dropoff)

    try:
        response = client.get(f"/api/reservations/{alone['id']}/overlapping")
        assert response.status_code == 200
        assert response.json() == {"items": [], "suggested_id": None, "suggested_reasons": []}
    finally:
        client.patch(f"/api/reservations/{alone['id']}/cancel")


def test_overlapping_reservation_not_found_is_404():
    response = client.get(f"/api/reservations/{uuid4()}/overlapping")
    assert response.status_code == 404


def test_overlapping_reservations_need_a_signed_in_user():
    from app.dependencies import get_current_user

    car = ensure_car_available("SA-004-AA")
    location_id = car["current_location"]["id"]
    pickup, dropoff = _window()
    reservation = create_reservation(car["id"], location_id, pickup, dropoff)

    saved = app.dependency_overrides.pop(get_current_user, None)

    try:
        anon = TestClient(app)
        assert anon.get(f"/api/reservations/{reservation['id']}/overlapping").status_code == 401
    finally:
        if saved is not None:
            app.dependency_overrides[get_current_user] = saved
        client.patch(f"/api/reservations/{reservation['id']}/cancel")
