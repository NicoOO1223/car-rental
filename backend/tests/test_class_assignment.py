"""
Bookings made for a class hold a real car provisionally: best fit, moved aside when
room is needed, swapped by staff until pickup, and settled at check-in.
"""

import uuid
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Reservation
from app.services.email_outbox import vehicle_label
from tests._dates import far_future_days
from tests.test_email_outbox import _clean_outbox, _messages, email_on  # noqa: F401
from tests.test_public_booking import (  # noqa: F401  (fixtures)
    _book,
    _finish,
    _set_reservation,
    _succeed,
    _sync,
    fake_stripe,
    fresh_limits,
    storefront,
)
from tests.test_reservations import confirm_reservation, get_location_id

client = TestClient(app)


@pytest.fixture
def pool():
    """A class with two cars at Cagliari, and a way to book it; all taken out again afterwards."""

    cls = client.post(
        "/api/admin/vehicle-classes",
        json={"name": {"en": f"Pool {uuid.uuid4().hex[:6]}"}, "price_per_day": "40.00"},
    ).json()

    cars = []
    made = []

    for model in ("Panda", "Fiesta"):
        response = client.post(
            "/api/admin/cars",
            json={
                "make": "Fiat",
                "model": model,
                "year": 2023,
                "license_plate": f"CA-{uuid.uuid4().hex[:6].upper()}",
                "home_location_id": get_location_id("CAG"),
                "class_id": cls["id"],
                "offered_online": True,
            },
        )
        assert response.status_code == 201, response.text
        cars.append(response.json())

    base = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=far_future_days())

    def book(start_day, end_day, *, confirm=True, car_id=None):
        payload = {
            "customer": {
                "first_name": "Pool",
                "last_name": "Tester",
                "date_of_birth": "1990-01-01",
                "address": "Test Street 1",
                "postal_code": "1000AA",
                "phone_number": "+31600000000",
                "email": "pool.tester@example.com",
            },
            "pickup_location_id": get_location_id("CAG"),
            "return_location_id": get_location_id("CAG"),
            "pickup_at": (base + timedelta(days=start_day)).isoformat(),
            "return_at": (base + timedelta(days=end_day)).isoformat(),
            **({"car_id": car_id} if car_id else {"class_id": cls["id"]}),
        }
        response = client.post("/api/reservations", json=payload)

        if response.status_code != 201:
            return response

        made.append(response.json()["id"])

        if confirm:
            assert client.patch(f"/api/reservations/{response.json()['id']}/status", json={"status": "CONFIRMED"}).status_code == 200

        return client.get(f"/api/reservations/{response.json()['id']}")

    yield cls, cars, book, base

    for reservation_id in made:
        client.patch(f"/api/reservations/{reservation_id}/cancel")

    for car in cars:
        client.put(f"/api/admin/cars/{car['id']}/class", json={"class_id": None})
        client.post(f"/api/admin/cars/{car['id']}/retire")

    client.post(f"/api/admin/vehicle-classes/{cls['id']}/retire")


def _row(reservation_id: str) -> Reservation:
    db = SessionLocal()
    try:
        row = db.get(Reservation, UUID(reservation_id))
        db.expunge_all()

        return row
    finally:
        db.close()


def _force(reservation_id: str, car_id: str, confirmed: bool = False):
    db = SessionLocal()
    try:
        row = db.get(Reservation, UUID(reservation_id))
        row.car_id = UUID(car_id)
        row.car_confirmed = confirmed
        db.commit()
    finally:
        db.close()


def test_a_class_booking_holds_a_car_provisionally_and_knows_its_class(pool):
    cls, cars, book, _ = pool

    reservation = book(2, 4).json()

    assert reservation["class_id"] == cls["id"] and reservation["vehicle_class"]["id"] == cls["id"]
    assert reservation["car_confirmed"] is False
    assert reservation["car"]["id"] in {car["id"] for car in cars}


def test_a_booking_of_a_chosen_car_is_confirmed(pool):
    _, cars, book, _ = pool

    reservation = book(2, 4, car_id=cars[0]["id"]).json()

    assert reservation["car_confirmed"] is True and reservation["car"]["id"] == cars[0]["id"]


def test_best_fit_keeps_adjacent_bookings_on_one_car_and_the_other_whole(pool):
    _, cars, book, _ = pool

    first = book(2, 5).json()
    second = book(5, 8).json()
    third = book(3, 6).json()

    # Back to back: the same car, which leaves the other free for the overlapping one.
    assert second["car"]["id"] == first["car"]["id"]
    assert third["car"]["id"] != first["car"]["id"]


def test_when_no_car_is_free_a_provisional_booking_is_moved_aside(pool):
    _, cars, book, _ = pool
    a, b = cars

    early = book(2, 4).json()
    late = book(8, 10).json()
    _force(early["id"], a["id"])
    _force(late["id"], b["id"])

    # Overlaps both: needs a car whose booking can move to the other one.
    wide = book(3, 9)

    assert wide.status_code == 200, wide.text
    assert _row(early["id"]).car_id != _row(wide.json()["id"]).car_id
    assert _row(late["id"]).car_id != _row(wide.json()["id"]).car_id


def test_a_confirmed_car_never_moves_so_the_class_is_then_full(pool):
    _, cars, book, _ = pool
    a, b = cars

    early = book(2, 4).json()
    late = book(8, 10).json()
    _force(early["id"], a["id"], confirmed=True)
    _force(late["id"], b["id"], confirmed=True)

    refused = book(3, 9, confirm=False)

    assert refused.status_code == 400 and refused.json()["code"] == "reservation.class_has_no_free_car"
    assert _row(early["id"]).car_id == UUID(a["id"]) and _row(late["id"]).car_id == UUID(b["id"])


def test_staff_choosing_another_car_settles_it_and_confirm_car_does_too(pool):
    _, cars, book, _ = pool

    first = book(2, 4).json()
    other = next(car for car in cars if car["id"] != first["car"]["id"])

    swapped = client.patch(f"/api/reservations/{first['id']}", json={"car_id": other["id"]})

    assert swapped.status_code == 200, swapped.text
    assert _row(first["id"]).car_confirmed is True and _row(first["id"]).car_id == UUID(other["id"])

    second = book(10, 12).json()

    assert second["car_confirmed"] is False

    confirmed = client.post(f"/api/reservations/{second['id']}/confirm-car")

    assert confirmed.status_code == 200 and confirmed.json()["car_confirmed"] is True
    assert client.post(f"/api/reservations/{uuid.uuid4()}/confirm-car").status_code == 404


def test_maintenance_moves_provisional_bookings_to_another_car_but_not_confirmed_ones(pool):
    _, cars, book, base = pool
    a, b = cars

    provisional = book(2, 4).json()
    _force(provisional["id"], a["id"])

    window = {
        "starts_at": (base + timedelta(days=2, hours=1)).isoformat(),
        "ends_at": (base + timedelta(days=3)).isoformat(),
    }
    task = {"car_id": a["id"], "task_type": "MAINTENANCE", "category": "OTHER", "notes": None, **window}
    created = client.post("/api/maintenance/tasks", json=task)

    assert created.status_code in (200, 201), created.text
    assert _row(provisional["id"]).car_id == UUID(b["id"])

    settled = book(20, 22).json()
    _force(settled["id"], a["id"], confirmed=True)
    blocked = client.post(
        "/api/maintenance/tasks",
        json={**task, "starts_at": (base + timedelta(days=20, hours=1)).isoformat(), "ends_at": (base + timedelta(days=21)).isoformat()},
    )

    assert blocked.status_code == 400
    client.patch(f"/api/maintenance/tasks/{created.json()['id']}/complete", json={})


def test_a_late_payment_finds_another_car_of_the_class_instead_of_a_refund(storefront, fake_stripe, pool):
    cls, cars, book, base = pool
    a, b = cars

    # Pick dates inside the public booking range, away from the staff bookings above.
    from tests.test_public_booking import _offer_for, _payload, _window

    pickup, dropoff = _window()
    location_id = get_location_id("CAG")
    offers = client.get(
        "/api/public/availability",
        params={"pickup_location_id": location_id, "pickup_at": pickup.strftime("%Y-%m-%dT%H:%M:%SZ"), "return_at": dropoff.strftime("%Y-%m-%dT%H:%M:%SZ")},
    ).json()["offers"]
    offer = next(o for o in offers if o["offer_key"] == f"class-{cls['slug']}")
    created = client.post(
        "/api/public/bookings",
        json=_payload(offer, location_id, pickup, dropoff, email=f"late-{uuid.uuid4().hex[:6]}@example.com"),
        headers={"X-Forwarded-For": f"198.19.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250 + 1}"},
    )

    assert created.status_code == 201, created.text

    reference = created.json()["reference"]
    held = client.get(
        f"/api/public/bookings/{reference}", headers={"Authorization": f"Bearer {created.json()['manage_token']}"}
    )
    assert held.status_code == 200

    try:
        db = SessionLocal()
        try:
            held_car = db.scalar(select(Reservation.car_id).where(Reservation.public_reference == reference))
        finally:
            db.close()

        # The hold runs out and someone else takes exactly that car.
        _set_reservation(reference, status="EXPIRED", hold_expires_at=datetime.now(timezone.utc) - timedelta(minutes=5))
        taken = client.post(
            "/api/reservations",
            json={
                "customer": {
                    "first_name": "Else", "last_name": "Body", "date_of_birth": "1990-01-01", "address": "x",
                    "postal_code": "1", "phone_number": "+31600000001", "email": "else@example.com",
                },
                "car_id": str(held_car),
                "pickup_location_id": location_id,
                "return_location_id": location_id,
                "pickup_at": pickup.isoformat(),
                "return_at": dropoff.isoformat(),
            },
        )
        assert taken.status_code == 201, taken.text
        confirm_reservation(taken.json()["id"])

        _succeed(fake_stripe, reference)
        result = _sync(reference, created.json()["manage_token"])

        assert result.json()["status"] == "CONFIRMED"
        assert not fake_stripe.refunds

        db = SessionLocal()
        try:
            now_car = db.scalar(select(Reservation.car_id).where(Reservation.public_reference == reference))
        finally:
            db.close()

        assert now_car != held_car
        client.patch(f"/api/reservations/{taken.json()['id']}/cancel")
    finally:
        _finish(reference)


def test_the_renter_is_told_the_class_with_an_example_until_the_car_is_settled(pool):
    _, cars, book, _ = pool

    reservation = book(2, 4).json()
    db = SessionLocal()
    try:
        row = db.get(Reservation, UUID(reservation["id"]))
        provisional = vehicle_label(row, "en")
        italian = vehicle_label(row, "it")
        row.car_confirmed = True
        settled = vehicle_label(row, "en")
        db.rollback()
    finally:
        db.close()

    assert "(Fiat" in provisional and provisional.endswith("or similar)")
    assert italian.endswith("o simile)")
    assert settled.startswith("Fiat ") and "similar" not in settled


def test_swapping_the_car_inside_a_class_sends_the_renter_no_change_email(email_on, pool):
    _, cars, book, _ = pool

    reservation = book(2, 4).json()
    other = next(car for car in cars if car["id"] != reservation["car"]["id"])
    before = len([m for m in _messages(reservation["id"]) if m.template == "booking_changed"])

    # Same dates and class, a different car: nothing the renter was told has changed.
    assert client.patch(f"/api/reservations/{reservation['id']}", json={"car_id": other["id"]}).status_code == 200
    assert len([m for m in _messages(reservation["id"]) if m.template == "booking_changed"]) == before
