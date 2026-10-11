"""
A manual price adjustment on a reservation: a signed line of its own with a reason,
folded into VAT and the total, kept through a re-price, audited, refused once paid,
and limited by role (staff add an adjustment; managers can also set the total or keep
the agreed price after a car change).
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, User
from app.services.price_adjustments import adjustment_for_total
from app.services.pricing import calculate_price_breakdown
from tests._dates import far_future_days
from tests.test_booking_safety import _online_payment
from tests.test_reservations import get_location_id

client = TestClient(app)


# ---- the arithmetic ---------------------------------------------------------------------


def _breakdown(adjustment="0.00", vat="0", includes=True):
    place = uuid.uuid4()

    return calculate_price_breakdown(
        Decimal("40.00"),
        datetime(2027, 1, 1, 10, tzinfo=timezone.utc),
        datetime(2027, 1, 4, 10, tzinfo=timezone.utc),
        place,
        place,
        short_term_threshold_days=0,
        short_term_fee=Decimal("0.00"),
        airport_change_fee=Decimal("0.00"),
        vat_rate=Decimal(vat),
        prices_include_vat=includes,
        adjustment_amount=Decimal(adjustment),
    )


def test_an_adjustment_is_a_line_of_its_own_and_the_total_follows():
    plain = _breakdown()
    discounted = _breakdown("-20.00")
    surcharged = _breakdown("15.50")

    assert plain.total_amount == Decimal("120.00")
    assert discounted.total_amount == Decimal("100.00") and discounted.adjustment == Decimal("-20.00")
    assert surcharged.total_amount == Decimal("135.50")


def test_vat_follows_the_adjustment_in_both_modes():
    included = _breakdown("-20.00", vat="22", includes=True)
    added = _breakdown("-20.00", vat="22", includes=False)

    # Prices include VAT: 100.00 total, of which 22/122 is tax.
    assert included.total_amount == Decimal("100.00")
    assert included.vat_amount == Decimal("18.03")
    # Prices exclude VAT: lines are net, the tax goes on top of 100.00.
    assert added.net_amount == Decimal("100.00")
    assert added.vat_amount == Decimal("22.00") and added.total_amount == Decimal("122.00")


def test_a_discount_never_takes_the_price_below_nothing():
    assert _breakdown("-500.00").total_amount == Decimal("0.00")
    assert _breakdown("-500.00").adjustment == Decimal("-120.00")


def test_the_adjustment_that_reaches_a_target_total():
    assert adjustment_for_total(Decimal("120.00"), Decimal("100.00"), Decimal("22"), True) == Decimal("-20.00")
    # VAT on top: a gross target of 122.00 is net lines of 100.00.
    assert adjustment_for_total(Decimal("120.00"), Decimal("122.00"), Decimal("22"), False) == Decimal("-20.00")


# ---- through the API --------------------------------------------------------------------


@pytest.fixture
def desk():
    """Makes cars at Cagliari and reservations on them; cancels and retires them afterwards."""

    cars: list[str] = []
    reservations: list[str] = []
    base = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=far_future_days())

    def car(price):
        response = client.post(
            "/api/admin/cars",
            json={
                "make": "Adjust",
                "model": f"M{uuid.uuid4().hex[:4]}",
                "year": 2024,
                "license_plate": f"AD-{uuid.uuid4().hex[:6].upper()}",
                "home_location_id": get_location_id("CAG"),
                "price_per_day": price,
                "offered_online": False,
            },
        )

        assert response.status_code == 201, response.text
        cars.append(response.json()["id"])

        return response.json()

    # Five days: a shorter rental carries the short-term fee, which these totals leave out.
    def book(car_id, days=5):
        response = client.post(
            "/api/reservations",
            json={
                "customer": {
                    "first_name": "Adjust",
                    "last_name": "Tester",
                    "date_of_birth": "1990-01-01",
                    "address": "Test Street 1",
                    "postal_code": "1000AA",
                    "phone_number": "+31600000000",
                    "email": f"adjust.{uuid.uuid4().hex[:6]}@example.com",
                },
                "pickup_location_id": get_location_id("CAG"),
                "return_location_id": get_location_id("CAG"),
                "pickup_at": base.isoformat(),
                "return_at": (base + timedelta(days=days)).isoformat(),
                "car_id": car_id,
            },
        )

        assert response.status_code == 201, response.text
        reservations.append(response.json()["id"])

        return response.json()

    yield car, book

    for reservation_id in reservations:
        client.patch(f"/api/reservations/{reservation_id}/cancel")

    for car_id in cars:
        client.post(f"/api/admin/cars/{car_id}/retire")


def _as(role):
    """Acts as a real user of this role (the audit trail points at users)."""

    original = app.dependency_overrides.get(get_current_user)
    email = f"{role}.{uuid.uuid4().hex[:8]}@example.com"
    db = SessionLocal()
    try:
        row = User(email=email, hashed_password="x", role=role, is_active=True)
        db.add(row)
        db.commit()
        db.refresh(row)
        user = User(id=row.id, email=email, hashed_password="x", role=role, is_active=True)
    finally:
        db.close()

    app.dependency_overrides[get_current_user] = lambda: user

    return original


def _restore(original):
    if original is None:
        app.dependency_overrides.pop(get_current_user, None)
    else:
        app.dependency_overrides[get_current_user] = original


def _total(reservation_id):
    return Decimal(str(client.get(f"/api/reservations/{reservation_id}").json()["agreed_total_amount"]))


def test_staff_can_add_a_discount_with_a_reason_and_it_is_audited(desk):
    car, book = desk
    reservation = book(car(40)["id"])

    assert _total(reservation["id"]) == Decimal("200.00")

    response = client.put(
        f"/api/reservations/{reservation['id']}/price-adjustment",
        json={"amount": "-20.00", "reason": "Regular customer"},
    )

    assert response.status_code == 200, response.text
    assert Decimal(response.json()["agreed_total_amount"]) == Decimal("180.00")
    assert Decimal(response.json()["price_adjustment_amount"]) == Decimal("-20.00")
    assert response.json()["price_adjustment_reason"] == "Regular customer"

    db = SessionLocal()
    try:
        entry = db.scalar(
            select(AuditLog)
            .where(AuditLog.entity_type == "reservation", AuditLog.action == "reservation.price_adjusted")
            .order_by(AuditLog.created_at.desc())
        )

        assert entry.details["reason"] == "Regular customer"
        assert entry.details["old_total"] == "200.00" and entry.details["new_total"] == "180.00"
    finally:
        db.close()


def test_staff_must_give_a_reason_but_a_manager_need_not(desk):
    car, book = desk
    reservation = book(car(40)["id"])
    url = f"/api/reservations/{reservation['id']}/price-adjustment"

    original = _as("staff")
    try:
        missing = client.put(url, json={"amount": "-5", "reason": ""})
        blank = client.put(url, json={"amount": "-5", "reason": "  "})
        given = client.put(url, json={"amount": "-5", "reason": "Regular customer"})
    finally:
        _restore(original)

    assert missing.status_code == 400 and missing.json()["code"] == "reservation.price_reason_required"
    assert blank.status_code == 400
    assert given.status_code == 200

    original = _as("manager")
    try:
        without = client.put(url, json={"amount": "-10"})
    finally:
        _restore(original)

    assert without.status_code == 200, without.text
    assert Decimal(without.json()["agreed_total_amount"]) == Decimal("190.00")
    assert without.json()["price_adjustment_reason"] is None


def test_a_discount_cannot_exceed_the_price(desk):
    car, book = desk
    reservation = book(car(40)["id"])
    url = f"/api/reservations/{reservation['id']}/price-adjustment"

    too_much = client.put(url, json={"amount": "-500", "reason": "Too generous"})

    assert too_much.status_code == 400 and too_much.json()["code"] == "reservation.discount_exceeds_price"
    assert _total(reservation["id"]) == Decimal("200.00")


def test_zero_removes_the_adjustment(desk):
    car, book = desk
    reservation = book(car(40)["id"])
    url = f"/api/reservations/{reservation['id']}/price-adjustment"

    client.put(url, json={"amount": "-20", "reason": "Courtesy"})
    cleared = client.put(url, json={"amount": "0", "reason": "Removed"})

    assert cleared.status_code == 200
    assert cleared.json()["price_adjustment_amount"] is None
    assert Decimal(cleared.json()["agreed_total_amount"]) == Decimal("200.00")


def test_the_adjustment_survives_a_change_of_dates(desk):
    car, book = desk
    reservation = book(car(40)["id"], days=5)

    client.put(
        f"/api/reservations/{reservation['id']}/price-adjustment",
        json={"amount": "-20", "reason": "Courtesy"},
    )

    start = datetime.fromisoformat(reservation["pickup_at"].replace("Z", "+00:00"))
    moved = client.patch(
        f"/api/reservations/{reservation['id']}",
        json={"return_at": (start + timedelta(days=6)).isoformat()},
    )

    assert moved.status_code == 200, moved.text
    # 6 days at 40.00, less the 20.00 adjustment that is still there.
    assert Decimal(moved.json()["agreed_total_amount"]) == Decimal("220.00")
    assert Decimal(moved.json()["price_adjustment_amount"]) == Decimal("-20.00")


def test_a_manager_sets_the_final_total_and_staff_cannot(desk):
    car, book = desk
    reservation = book(car(40)["id"])
    url = f"/api/reservations/{reservation['id']}/final-total"

    original = _as("staff")
    try:
        denied = client.put(url, json={"total": "90.00", "reason": "Agreed by phone"})
    finally:
        _restore(original)

    assert denied.status_code == 403

    original = _as("manager")
    try:
        done = client.put(url, json={"total": "90.00", "reason": "Agreed by phone"})
    finally:
        _restore(original)

    assert done.status_code == 200, done.text
    assert Decimal(done.json()["agreed_total_amount"]) == Decimal("90.00")
    assert Decimal(done.json()["price_adjustment_amount"]) == Decimal("-110.00")


def test_staff_may_adjust_but_not_the_other_price_tools(desk):
    car, book = desk
    reservation = book(car(40)["id"])

    original = _as("staff")
    try:
        allowed = client.put(
            f"/api/reservations/{reservation['id']}/price-adjustment",
            json={"amount": "10", "reason": "Child seat agreed"},
        )
        keep = client.patch(f"/api/reservations/{reservation['id']}", json={"price_policy": "keep"})
    finally:
        _restore(original)

    assert allowed.status_code == 200, allowed.text
    assert keep.status_code == 403 and keep.json()["code"] == "reservation.price_needs_manager"


def test_a_manager_can_keep_the_agreed_price_when_the_car_changes(desk):
    car, book = desk
    cheap, dear = car(40), car(60)
    reservation = book(cheap["id"], days=5)

    # By default the new car's rate applies.
    repriced = client.patch(f"/api/reservations/{reservation['id']}", json={"car_id": dear["id"]})

    assert repriced.status_code == 200, repriced.text
    assert Decimal(repriced.json()["agreed_total_amount"]) == Decimal("300.00")

    # Back to the cheap car, then up again keeping the agreed price.
    client.patch(f"/api/reservations/{reservation['id']}", json={"car_id": cheap["id"]})
    assert _total(reservation["id"]) == Decimal("200.00")

    kept = client.patch(
        f"/api/reservations/{reservation['id']}", json={"car_id": dear["id"], "price_policy": "keep"}
    )

    assert kept.status_code == 200, kept.text
    assert kept.json()["car"]["id"] == dear["id"]
    assert Decimal(kept.json()["agreed_total_amount"]) == Decimal("200.00")
    assert Decimal(kept.json()["price_adjustment_amount"]) == Decimal("-100.00")


def test_the_price_cannot_be_adjusted_once_a_payment_exists(desk):
    car, book = desk
    reservation = book(car(40)["id"])

    _online_payment(reservation, "SUCCEEDED")

    refused = client.put(
        f"/api/reservations/{reservation['id']}/price-adjustment",
        json={"amount": "-10", "reason": "Too late"},
    )

    assert refused.status_code == 400
    assert refused.json()["code"] == "reservation.price_cannot_change_after_payment"
    assert _total(reservation["id"]) == Decimal("200.00")


def test_the_suggested_pick_follows_the_adjusted_value(desk):
    car, book = desk
    shared_car = car(40)
    first = book(shared_car["id"], days=3)
    second = book(shared_car["id"], days=3)

    # Same car, same dates: the earlier request leads, until the other is surcharged above it.
    client.put(
        f"/api/reservations/{second['id']}/price-adjustment",
        json={"amount": "50", "reason": "Extra driver agreed"},
    )

    overlaps = client.get(f"/api/reservations/{first['id']}/overlapping").json()

    assert overlaps["suggested_id"] == second["id"]
