import re
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from tests._dates import far_future_days
from tests.test_handovers import create_confirmed_reservation

client = TestClient(app)


def _far_dates(days=2):
    pickup = datetime.now(timezone.utc) + timedelta(days=far_future_days())

    return (
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (pickup + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _make_reservation():
    pickup_at, return_at = _far_dates()

    return create_confirmed_reservation("SA-008-AA", pickup_at, return_at)


def _cancel(reservation):
    client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- reservations -------------------------------------------------------


def test_reservation_list_is_paged_with_a_total():
    first = _make_reservation()
    second = _make_reservation()

    try:
        page = client.get("/api/reservations", params={"limit": 1}).json()

        assert len(page["items"]) == 1
        assert page["limit"] == 1
        assert page["offset"] == 0
        assert page["total"] >= 2

        next_page = client.get(
            "/api/reservations", params={"limit": 1, "offset": 1}
        ).json()

        assert next_page["items"][0]["id"] != page["items"][0]["id"]
        assert next_page["total"] == page["total"]
    finally:
        _cancel(first)
        _cancel(second)


def test_reservation_limit_is_capped():
    assert client.get("/api/reservations", params={"limit": 101}).status_code == 422
    assert client.get("/api/reservations", params={"limit": 0}).status_code == 422
    assert client.get("/api/reservations", params={"offset": -1}).status_code == 422


def test_reservation_search_matches_customer_plate_and_id():
    reservation = _make_reservation()

    try:
        by_id = client.get(
            "/api/reservations", params={"q": reservation["id"][:8]}
        ).json()
        assert reservation["id"] in [row["id"] for row in by_id["items"]]

        by_plate = client.get(
            "/api/reservations", params={"q": "sa-008-aa", "limit": 100}
        ).json()
        assert by_plate["total"] >= 1
        assert all(
            row["car"]["license_plate"] == "SA-008-AA" for row in by_plate["items"]
        )

        nothing = client.get(
            "/api/reservations", params={"q": "zzzz-no-such-thing"}
        ).json()
        assert nothing["total"] == 0
        assert nothing["items"] == []
    finally:
        _cancel(reservation)


def test_reservation_search_treats_wildcards_literally():
    # An unescaped % would match everything.
    response = client.get("/api/reservations", params={"q": "%"}).json()

    assert response["total"] == 0


def test_reservation_status_filter_and_sort_order():
    reservation = _make_reservation()

    try:
        confirmed = client.get(
            "/api/reservations",
            params={"status": "CONFIRMED", "sort": "pickup_asc", "limit": 100},
        ).json()

        assert all(row["status"] == "CONFIRMED" for row in confirmed["items"])

        pickups = [row["pickup_at"] for row in confirmed["items"]]
        assert pickups == sorted(pickups)

        latest_first = client.get(
            "/api/reservations",
            params={"status": "CONFIRMED", "sort": "pickup_desc", "limit": 100},
        ).json()
        desc = [row["pickup_at"] for row in latest_first["items"]]
        assert desc == sorted(desc, reverse=True)
    finally:
        _cancel(reservation)


def test_reservation_status_filter_rejects_unknown_values():
    assert client.get("/api/reservations", params={"status": "NOPE"}).status_code == 422


def test_reservation_window_filters():
    now = datetime.now(timezone.utc)

    upcoming = client.get(
        "/api/reservations", params={"window": "UPCOMING", "limit": 100}
    ).json()
    for row in upcoming["items"]:
        assert row["status"] == "CONFIRMED"
        assert datetime.fromisoformat(row["pickup_at"]) > now

    week = client.get(
        "/api/reservations", params={"window": "NEXT_7_DAYS", "limit": 100}
    ).json()
    for row in week["items"]:
        picked = datetime.fromisoformat(row["pickup_at"])
        assert now - timedelta(minutes=1) <= picked <= now + timedelta(days=7, minutes=1)

    on_road = client.get(
        "/api/reservations", params={"window": "ACTIVE", "limit": 100}
    ).json()
    for row in on_road["items"]:
        assert datetime.fromisoformat(row["pickup_at"]) <= now
        assert datetime.fromisoformat(row["return_at"]) >= now - timedelta(minutes=1)


def test_reservation_today_window_uses_the_callers_day():
    reservation = _make_reservation()
    pickup = datetime.fromisoformat(reservation["pickup_at"].replace("Z", "+00:00"))
    day_start = pickup.replace(hour=0, minute=0, second=0, microsecond=0)

    try:
        hit = client.get(
            "/api/reservations",
            params={
                "window": "TODAY",
                "day_start": day_start.isoformat(),
                "day_end": (day_start + timedelta(days=1)).isoformat(),
            },
        ).json()
        assert reservation["id"] in [row["id"] for row in hit["items"]]

        miss_start = day_start - timedelta(days=30)
        miss = client.get(
            "/api/reservations",
            params={
                "window": "TODAY",
                "day_start": miss_start.isoformat(),
                "day_end": (miss_start + timedelta(days=1)).isoformat(),
            },
        ).json()
        assert reservation["id"] not in [row["id"] for row in miss["items"]]
    finally:
        _cancel(reservation)


def test_reservation_location_filter():
    reservation = _make_reservation()

    try:
        olb = client.get(
            "/api/reservations", params={"location": "OLB", "limit": 100}
        ).json()
        for row in olb["items"]:
            assert "OLB" in (
                row["pickup_location"]["airport_code"],
                row["return_location"]["airport_code"],
            )
    finally:
        _cancel(reservation)


def test_reservation_summary_counts():
    reservation = _make_reservation()

    try:
        summary = client.get("/api/reservations/summary").json()

        assert set(summary) == {
            "total",
            "pickup_today",
            "return_today",
            "active",
            "upcoming",
            "overdue_returns",
        }
        assert summary["total"] >= 1
        assert summary["upcoming"] >= 1
        assert all(value >= 0 for value in summary.values())

        total = client.get("/api/reservations", params={"limit": 1}).json()["total"]
        assert summary["total"] == total
    finally:
        _cancel(reservation)


# --- customers ----------------------------------------------------------


def test_customer_list_is_paged_with_a_total():
    reservation = _make_reservation()

    try:
        page = client.get("/api/customers", params={"limit": 1}).json()

        assert len(page["items"]) == 1
        assert page["total"] >= 1
        assert page["limit"] == 1
    finally:
        _cancel(reservation)


def test_customer_limit_is_capped():
    assert client.get("/api/customers", params={"limit": 101}).status_code == 422


def test_customer_search_by_name_email_and_phone():
    reservation = _make_reservation()

    try:
        detail = client.get(f"/api/reservations/{reservation['id']}").json()
        customer = client.get(f"/api/customers/{detail['customer']['id']}").json()

        by_name = client.get(
            "/api/customers", params={"q": customer["last_name"], "limit": 100}
        ).json()
        assert customer["id"] in [row["id"] for row in by_name["items"]]

        if customer["email"]:
            by_email = client.get(
                "/api/customers", params={"q": customer["email"], "limit": 100}
            ).json()
            assert customer["id"] in [row["id"] for row in by_email["items"]]

        nothing = client.get("/api/customers", params={"q": "zzzz-no-such"}).json()
        assert nothing["total"] == 0

        wildcard = client.get("/api/customers", params={"q": "%"}).json()
        assert wildcard["total"] == 0
    finally:
        _cancel(reservation)


def test_customer_segments_and_name_sort():
    repeat = client.get(
        "/api/customers", params={"segment": "REPEAT", "limit": 100}
    ).json()
    assert all(row["reservation_count"] >= 2 for row in repeat["items"])

    fresh = client.get(
        "/api/customers", params={"segment": "NEW_THIS_WEEK", "limit": 100}
    ).json()
    cutoff = datetime.now(timezone.utc) - timedelta(days=7, minutes=1)
    assert all(
        datetime.fromisoformat(row["created_at"]) >= cutoff for row in fresh["items"]
    )

    by_name = client.get(
        "/api/customers", params={"sort": "name", "limit": 100}
    ).json()
    # Postgres sorts with the database's locale, which orders punctuation
    # and digits differently from Python. The first letter is the part both
    # agree on.
    def first_letter(value):
        match = re.search(r"[a-z]", value.lower())
        return match.group(0) if match else ""

    keys = [first_letter(row["last_name"]) for row in by_name["items"]]
    assert keys == sorted(keys)


def test_customer_summary_matches_the_list():
    summary = client.get("/api/customers/summary").json()

    assert summary["total"] == client.get("/api/customers").json()["total"]
    assert summary["repeat_customers"] == client.get(
        "/api/customers", params={"segment": "REPEAT"}
    ).json()["total"]
    assert summary["new_this_week"] == client.get(
        "/api/customers", params={"segment": "NEW_THIS_WEEK"}
    ).json()["total"]
    assert summary["total_reservations"] >= 0
