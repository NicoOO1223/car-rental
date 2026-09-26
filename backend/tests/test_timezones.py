"""
Days follow the business's and each location's timezone, not UTC.

Most cases pick instants that are on one calendar day in UTC and on another
in the zone under test, so they only pass if the zone is really applied.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Location
from app.services.timezones import (
    assume_zone,
    day_bounds,
    local_date,
    local_today,
    range_bounds,
    zone,
)
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    force_reservation_status,
)

client = TestClient(app)

KIRITIMATI = "Pacific/Kiritimati"  # UTC+14, no daylight saving
ROME = ZoneInfo("Europe/Rome")


# --- the helpers ------------------------------------------------------------


def test_unknown_or_empty_names_fall_back_to_utc():
    assert zone(None) == ZoneInfo("UTC")
    assert zone("") == ZoneInfo("UTC")
    assert zone("Mars/Base") == ZoneInfo("UTC")
    assert zone("Europe/Rome") == ROME


def test_local_today_follows_the_zone():
    # 23:30 UTC on the 14th is already the 15th in Rome (UTC+2 in summer).
    instant = datetime(2040, 6, 14, 23, 30, tzinfo=timezone.utc)

    assert local_today(ZoneInfo("UTC"), instant) == date(2040, 6, 14)
    assert local_today(ROME, instant) == date(2040, 6, 15)
    assert local_today(ZoneInfo("America/Los_Angeles"), instant) == date(2040, 6, 14)


def test_local_date_treats_a_naive_datetime_as_utc():
    naive = datetime(2040, 6, 14, 23, 30)

    assert local_date(naive, ROME) == date(2040, 6, 15)


def test_day_bounds_are_local_midnights_as_instants():
    start, end = day_bounds(date(2040, 6, 15), ROME)

    assert start.astimezone(timezone.utc) == datetime(2040, 6, 14, 22, 0, tzinfo=timezone.utc)
    assert end.astimezone(timezone.utc) == datetime(2040, 6, 15, 22, 0, tzinfo=timezone.utc)


def test_a_day_with_a_clock_change_is_not_24_hours():
    # Rome springs forward on the last Sunday of March and falls back in October.
    spring = day_bounds(date(2040, 3, 25), ROME)
    autumn = day_bounds(date(2040, 10, 28), ROME)
    ordinary = day_bounds(date(2040, 6, 15), ROME)

    def hours(bounds):
        # Compared as instants: two datetimes sharing a tzinfo would
        # otherwise subtract by wall-clock time and hide the change.
        start, end = (b.astimezone(timezone.utc) for b in bounds)
        return end - start

    assert hours(spring) == timedelta(hours=23)
    assert hours(autumn) == timedelta(hours=25)
    assert hours(ordinary) == timedelta(hours=24)


def test_range_bounds_span_first_to_last_day():
    start, end = range_bounds(date(2040, 6, 15), date(2040, 6, 17), ROME)

    assert end.astimezone(timezone.utc) - start.astimezone(timezone.utc) == timedelta(days=3)
    assert start == day_bounds(date(2040, 6, 15), ROME)[0]


def test_assume_zone_only_fills_in_a_missing_zone():
    naive = datetime(2040, 6, 15, 10, 0)
    aware = datetime(2040, 6, 15, 10, 0, tzinfo=timezone.utc)

    assert assume_zone(naive, ROME).utcoffset() == timedelta(hours=2)
    assert assume_zone(aware, ROME) is aware


# --- the business timezone through the API -----------------------------------


@pytest.fixture
def business_timezone():
    """Sets the business timezone for a test and puts it back."""

    original = client.get("/api/configuration").json()["timezone"]

    def set_to(name: str):
        response = client.patch("/api/configuration", json={"timezone": name})
        assert response.status_code == 200

    yield set_to

    client.patch("/api/configuration", json={"timezone": original})


def _zone_whose_date_differs_from_utc() -> str:
    """At any moment, either Kiritimati (UTC+14) or Pago Pago (UTC-11) is on
    a different calendar day from UTC."""

    now = datetime.now(timezone.utc)

    for name in (KIRITIMATI, "Pacific/Pago_Pago"):
        if local_today(ZoneInfo(name), now) != now.date():
            return name

    raise AssertionError("unreachable: one of the two always differs")


def _instant_in_local_today_but_not_utc_today(tz_name: str) -> datetime:
    """A moment on today's calendar day in the zone that is NOT on today's
    UTC calendar day."""

    tz = ZoneInfo(tz_name)
    now = datetime.now(timezone.utc)
    local_start, local_end = day_bounds(local_today(tz, now), tz)
    utc_start = datetime.combine(now.date(), datetime.min.time(), tzinfo=timezone.utc)
    utc_end = utc_start + timedelta(days=1)

    moment = local_start + timedelta(minutes=30)

    while moment < local_end:
        if not (utc_start <= moment < utc_end):
            return moment
        moment += timedelta(minutes=30)

    raise AssertionError("no such instant")


def _instant_on_different_dates(tz_name: str) -> datetime:
    """A moment whose calendar date in the zone differs from its date in UTC."""

    tz = ZoneInfo(tz_name)
    local_start, local_end = day_bounds(local_today(tz), tz)
    moment = local_start + timedelta(minutes=30)

    while moment < local_end:
        if local_date(moment, tz) != moment.astimezone(timezone.utc).date():
            return moment
        moment += timedelta(minutes=30)

    raise AssertionError("no such instant")


def _create_at(plate: str, instant: datetime) -> dict:
    car = ensure_car_available(plate)

    return create_reservation(
        car["id"],
        car["current_location"]["id"],
        instant.isoformat(),
        (instant + timedelta(minutes=45)).isoformat(),
    )


def _in_window(window: str, reservation_id: str) -> bool:
    # Searched by id so the answer cannot be pushed off the first page by
    # other rows the shared test database has accumulated.
    response = client.get(
        "/api/reservations",
        params={"window": window, "q": reservation_id, "limit": 100},
    )
    return reservation_id in {row["id"] for row in response.json()["items"]}


def test_todays_reservations_are_todays_in_the_business_zone(business_timezone):
    zone_name = _zone_whose_date_differs_from_utc()
    moment = _instant_in_local_today_but_not_utc_today(zone_name)
    reservation = _create_at("SA-008-AA", moment)

    try:
        business_timezone("UTC")
        assert not _in_window("TODAY", reservation["id"])

        business_timezone(zone_name)
        assert _in_window("TODAY", reservation["id"])
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_dashboard_today_counts_follow_the_business_zone(business_timezone):
    zone_name = _zone_whose_date_differs_from_utc()
    moment = _instant_in_local_today_but_not_utc_today(zone_name)

    def pickups_today() -> int:
        return client.get("/api/dashboard").json()["today"]["pickups"]

    business_timezone(zone_name)
    before = pickups_today()

    reservation = _create_at("SA-008-AA", moment)

    try:
        assert pickups_today() == before + 1

        business_timezone("UTC")
        assert pickups_today() == before  # not today in UTC
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_revenue_is_attributed_to_the_business_day(business_timezone):
    zone_name = _zone_whose_date_differs_from_utc()
    tz = ZoneInfo(zone_name)
    moment = _instant_on_different_dates(zone_name)
    local_day = local_date(moment, tz)
    utc_day = moment.astimezone(timezone.utc).date()
    assert local_day != utc_day

    def revenue_on(day: date) -> float:
        body = client.get(
            "/api/dashboard/revenue",
            params={"start_date": str(day - timedelta(days=1)), "end_date": str(day + timedelta(days=1))},
        ).json()
        return next(p["revenue"] for p in body["points"] if p["date"] == str(day))

    business_timezone(zone_name)
    local_before = revenue_on(local_day)

    reservation = _create_at("SA-008-AA", moment)
    force_reservation_status(reservation["id"], "COMPLETED")

    try:
        assert revenue_on(local_day) > local_before

        # Seen from UTC the same rental belongs to the other day.
        business_timezone("UTC")
        assert revenue_on(utc_day) > 0
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- a location's own timezone ---------------------------------------------


@pytest.fixture
def olb_in_zone():
    """Puts the Olbia location in a timezone for a test and restores it."""

    db = SessionLocal()
    olb = db.scalar(select(Location).where(Location.airport_code == "OLB"))
    original = olb.timezone
    olb_id = olb.id
    db.close()

    def set_to(name: str):
        db = SessionLocal()
        db.get(Location, olb_id).timezone = name
        db.commit()
        db.close()

    yield olb_id, set_to

    set_to(original)


def test_fleet_status_for_a_day_uses_the_cars_location_zone(olb_in_zone):
    olb_id, set_zone = olb_in_zone
    car = next(
        c for c in client.get("/api/cars").json()
        if c["current_location"]["id"] == str(olb_id)
    )
    ensure_car_available(car["license_plate"])
    day = date(2040, 6, 15)

    # 00:10 to 00:40 local time in Kiritimati on the 15th: on the 14th in UTC.
    start = datetime(2040, 6, 15, 0, 10, tzinfo=ZoneInfo(KIRITIMATI))
    reservation = create_reservation(
        car["id"],
        str(olb_id),
        start.isoformat(),
        (start + timedelta(minutes=30)).isoformat(),
    )
    force_reservation_status(reservation["id"], "ACTIVE")

    def rented() -> int:
        return client.get(
            "/api/dashboard/fleet-status",
            params={"date": str(day), "location_id": str(olb_id)},
        ).json()["counts"]["rented"]

    try:
        set_zone("UTC")
        in_utc = rented()

        set_zone(KIRITIMATI)
        in_kiritimati = rented()

        assert in_kiritimati == in_utc + 1
    finally:
        force_reservation_status(reservation["id"], "CANCELLED")


# --- times typed without a zone -----------------------------------------------


def test_a_maintenance_time_without_a_zone_means_business_local_time(business_timezone):
    business_timezone("Europe/Rome")
    car = ensure_car_available("SA-006-AA")

    response = client.post(
        "/api/maintenance/tasks",
        json={
            "car_id": car["id"],
            "task_type": "CLEANING",
            "notes": None,
            "starts_at": "2040-06-15T10:00:00",
            "ends_at": "2040-06-15T12:00:00",
        },
    )

    assert response.status_code == 200
    task = response.json()

    try:
        # 10:00 in Rome in June is 08:00 UTC.
        assert datetime.fromisoformat(task["starts_at"]).astimezone(timezone.utc) == datetime(
            2040, 6, 15, 8, 0, tzinfo=timezone.utc
        )
    finally:
        client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")


# --- documents --------------------------------------------------------------


def test_format_local_names_the_zone():
    from app.services.pdf_common import format_local

    instant = datetime(2040, 6, 15, 8, 0, tzinfo=timezone.utc)

    assert format_local(instant, "Europe/Rome") == "2040-06-15 10:00 CEST"
    assert format_local(instant, "UTC") == "2040-06-15 08:00 UTC"
    assert format_local(datetime(2040, 1, 15, 8, 0), "Europe/Rome") == "2040-01-15 09:00 CET"
    assert format_local(None, "UTC") == "N/A"
