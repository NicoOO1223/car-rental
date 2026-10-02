from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import ensure_car_available

client = TestClient(app)

CLEAR = {
    "next_inspection_due": None,
    "insured_from": None,
    "insured_until": None,
    "insurance_cost": None,
    "mileage": None,
    "last_oil_change_at": None,
}


def _mine(plate):
    items = client.get("/api/notifications").json()["items"]

    return [item for item in items if item["car"]["license_plate"] == plate]


def _set_last_oil_change_mileage(car_id, value):
    # last_oil_change_mileage is set automatically when a ROUTINE_SERVICE
    # task completes (see services/maintenance.py) — there is deliberately
    # no API to edit it by hand, so a test has to reach into the database.
    from app.database import SessionLocal
    from app.models import Car

    db = SessionLocal()

    try:
        db.get(Car, car_id).last_oil_change_mileage = value
        db.commit()
    finally:
        db.close()


@pytest.fixture
def car():
    car = ensure_car_available("SA-006-AA")
    client.patch(f"/api/cars/{car['id']}", json=CLEAR)
    _set_last_oil_change_mileage(car["id"], None)

    yield car

    client.patch(f"/api/cars/{car['id']}", json=CLEAR)
    _set_last_oil_change_mileage(car["id"], None)


def test_a_car_with_nothing_due_raises_nothing(car):
    assert [i for i in _mine("SA-006-AA") if i["kind"] != "relocation"] == []


def test_an_inspection_is_flagged_when_due_soon_and_when_overdue(car):
    soon = (date.today() + timedelta(days=5)).isoformat()
    client.patch(f"/api/cars/{car['id']}", json={"next_inspection_due": soon})

    [item] = [i for i in _mine("SA-006-AA") if i["kind"].startswith("inspection")]
    assert item["kind"] == "inspection_due"
    assert item["severity"] == "warning"
    assert item["date"] == soon
    assert item["days"] in (4, 5, 6)

    client.patch(f"/api/cars/{car['id']}", json={"next_inspection_due": (date.today() - timedelta(days=3)).isoformat()})

    [item] = [i for i in _mine("SA-006-AA") if i["kind"].startswith("inspection")]
    assert item["kind"] == "inspection_overdue"
    assert item["severity"] == "critical"
    assert item["days"] < 0


def test_an_inspection_far_ahead_raises_nothing(car):
    client.patch(
        f"/api/cars/{car['id']}",
        json={"next_inspection_due": (date.today() + timedelta(days=200)).isoformat()},
    )

    assert [i for i in _mine("SA-006-AA") if i["kind"].startswith("inspection")] == []


def test_insurance_ending_and_expired_are_flagged(car):
    client.patch(f"/api/cars/{car['id']}", json={"insured_until": (date.today() + timedelta(days=10)).isoformat()})
    [item] = [i for i in _mine("SA-006-AA") if i["kind"].startswith("insurance")]
    assert item["kind"] == "insurance_ending"

    client.patch(f"/api/cars/{car['id']}", json={"insured_until": (date.today() - timedelta(days=1)).isoformat()})
    [item] = [i for i in _mine("SA-006-AA") if i["kind"].startswith("insurance")]
    assert item["kind"] == "insurance_expired"
    assert item["severity"] == "critical"


def test_oil_change_due_is_flagged_once_the_distance_threshold_is_crossed(car):
    interval = client.get("/api/configuration").json()["oil_change_interval_km"]

    client.patch(f"/api/cars/{car['id']}", json={"mileage": 50000})
    _set_last_oil_change_mileage(car["id"], 50000 - interval + 500)
    assert [i for i in _mine("SA-006-AA") if i["kind"] == "oil_change_due"] == []

    _set_last_oil_change_mileage(car["id"], 50000 - interval)
    [item] = [i for i in _mine("SA-006-AA") if i["kind"] == "oil_change_due"]
    assert item["severity"] == "warning"
    assert item["km_since"] == interval


def test_oil_change_due_needs_both_readings(car):
    client.patch(f"/api/cars/{car['id']}", json={"mileage": 50000})
    # last_oil_change_mileage stays null: nothing to compare against.
    assert [i for i in _mine("SA-006-AA") if i["kind"] == "oil_change_due"] == []


def test_the_window_follows_the_configured_reminder_days(car):
    original = client.get("/api/configuration").json()["reminder_days"]
    due = (date.today() + timedelta(days=20)).isoformat()

    try:
        client.patch(f"/api/cars/{car['id']}", json={"next_inspection_due": due})

        client.patch("/api/configuration", json={"reminder_days": 10})
        assert [i for i in _mine("SA-006-AA") if i["kind"].startswith("inspection")] == []

        client.patch("/api/configuration", json={"reminder_days": 30})
        assert len([i for i in _mine("SA-006-AA") if i["kind"].startswith("inspection")]) == 1
    finally:
        client.patch("/api/configuration", json={"reminder_days": original})


def test_critical_notifications_come_first():
    items = client.get("/api/notifications").json()["items"]
    severities = [item["severity"] for item in items]

    assert severities == sorted(severities, key=lambda value: value != "critical")


def test_notifications_need_a_signed_in_user():
    from app.dependencies import get_current_user

    saved = app.dependency_overrides.pop(get_current_user, None)

    try:
        assert TestClient(app).get("/api/notifications").status_code == 401
    finally:
        if saved is not None:
            app.dependency_overrides[get_current_user] = saved
