"""
What blocks a car: confirmed and active bookings, an online booking whose
payment hold has not run out, and a rental still out past its return time.
A PENDING request — not yet reviewed — deliberately does not block.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import Reservation
from app.services.availability import has_conflicting_reservation
from tests._dates import far_future_days
from tests.test_reservations import create_reservation, ensure_car_available, get_location_id

client = TestClient(app)


def _iso(value):
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def _booking():
    car = ensure_car_available("SA-005-AA")
    location_id = get_location_id("CAG")
    pickup = datetime.now(timezone.utc) + timedelta(days=far_future_days())
    reservation = create_reservation(car["id"], location_id, _iso(pickup), _iso(pickup + timedelta(days=2)))

    return car, reservation, pickup


def _conflicts(car, start, end):
    db = SessionLocal()
    try:
        return has_conflicting_reservation(db, UUID(car["id"]), start, end)
    finally:
        db.close()


def _set(reservation, **fields):
    db = SessionLocal()
    try:
        row = db.get(Reservation, UUID(reservation["id"]))
        for key, value in fields.items():
            setattr(row, key, value)
        db.commit()
    finally:
        db.close()


def test_an_unpaid_online_hold_blocks_the_car_until_it_runs_out():
    car, reservation, pickup = _booking()
    window = (pickup + timedelta(hours=1), pickup + timedelta(days=1))

    try:
        _set(reservation, status="AWAITING_PAYMENT", hold_expires_at=datetime.now(timezone.utc) + timedelta(minutes=10))
        assert _conflicts(car, *window) is True

        _set(reservation, hold_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        assert _conflicts(car, *window) is False
    finally:
        _set(reservation, status="CANCELLED")


def test_an_expired_booking_does_not_block():
    car, reservation, pickup = _booking()
    window = (pickup + timedelta(hours=1), pickup + timedelta(days=1))

    try:
        _set(reservation, status="CONFIRMED")
        assert _conflicts(car, *window) is True

        _set(reservation, status="EXPIRED")
        assert _conflicts(car, *window) is False
    finally:
        _set(reservation, status="CANCELLED")


def test_a_pending_request_does_not_block():
    car, reservation, pickup = _booking()
    window = (pickup + timedelta(hours=1), pickup + timedelta(days=1))

    try:
        # create_reservation() leaves a fresh booking as PENDING — an
        # unreviewed request, not a commitment, so it must not stop anyone
        # else from booking the same car and dates.
        assert _conflicts(car, *window) is False

        _set(reservation, status="CONFIRMED")
        assert _conflicts(car, *window) is True
    finally:
        _set(reservation, status="CANCELLED")


def test_a_rental_out_past_its_return_time_still_blocks_the_next_few_hours():
    car = ensure_car_available("SA-005-AA")
    location_id = get_location_id("CAG")
    now = datetime.now(timezone.utc)

    # Due back an hour ago and still out.
    overdue = create_reservation(car["id"], location_id, _iso(now - timedelta(days=2)), _iso(now - timedelta(hours=1)))

    try:
        _set(overdue, status="ACTIVE")

        assert _conflicts(car, now + timedelta(minutes=30), now + timedelta(hours=5)) is True
        assert _conflicts(car, now + timedelta(hours=4), now + timedelta(hours=9)) is False
    finally:
        _set(overdue, status="CANCELLED")


def test_staff_can_cancel_an_awaiting_payment_booking_but_not_confirm_it():
    car, reservation, pickup = _booking()

    try:
        _set(reservation, status="AWAITING_PAYMENT", hold_expires_at=datetime.now(timezone.utc) + timedelta(minutes=10))

        confirm = client.patch(f"/api/reservations/{reservation['id']}/status", json={"status": "CONFIRMED"})
        assert confirm.status_code == 400
        assert confirm.json()["code"] == "reservation.cannot_change_status"

        cancelled = client.patch(f"/api/reservations/{reservation['id']}/status", json={"status": "CANCELLED"})
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "CANCELLED"
    finally:
        _set(reservation, status="CANCELLED")


def test_a_rental_long_overdue_no_longer_blocks_by_itself():
    car = ensure_car_available("SA-005-AA")
    location_id = get_location_id("CAG")
    now = datetime.now(timezone.utc)

    forgotten = create_reservation(car["id"], location_id, _iso(now - timedelta(days=12)), _iso(now - timedelta(days=5)))

    try:
        _set(forgotten, status="ACTIVE")

        assert _conflicts(car, now + timedelta(minutes=30), now + timedelta(hours=5)) is False
    finally:
        _set(forgotten, status="CANCELLED")
