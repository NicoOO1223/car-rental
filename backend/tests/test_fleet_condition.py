from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import ensure_car_available
from tests.test_notifications import _set_last_oil_change_mileage

client = TestClient(app)

CLEAR = {
    "mileage": None,
    "last_oil_change_at": None,
    "insured_from": None,
    "insured_until": None,
    "insurance_cost": None,
}


def _get():
    return client.get("/api/fleet-condition").json()


def _mine(data, plate):
    return next(c for c in data["cars"] if c["license_plate"] == plate)


def test_a_car_with_both_readings_set_is_flagged_once_overdue():
    car = ensure_car_available("SA-006-AA")
    client.patch(f"/api/cars/{car['id']}", json=CLEAR)
    interval = client.get("/api/configuration").json()["oil_change_interval_km"]

    try:
        client.patch(f"/api/cars/{car['id']}", json={"mileage": 20000})
        _set_last_oil_change_mileage(car["id"], 20000 - interval + 1)
        assert _mine(_get(), "SA-006-AA")["oil_change_overdue"] is False

        _set_last_oil_change_mileage(car["id"], 20000 - interval)
        assert _mine(_get(), "SA-006-AA")["oil_change_overdue"] is True
    finally:
        client.patch(f"/api/cars/{car['id']}", json=CLEAR)
        _set_last_oil_change_mileage(car["id"], None)


def test_a_car_missing_either_reading_is_never_flagged():
    car = ensure_car_available("SA-006-AA")
    client.patch(f"/api/cars/{car['id']}", json=CLEAR)

    try:
        client.patch(f"/api/cars/{car['id']}", json={"mileage": 999999})
        assert _mine(_get(), "SA-006-AA")["oil_change_overdue"] is False
    finally:
        client.patch(f"/api/cars/{car['id']}", json=CLEAR)


def test_total_insurance_cost_includes_a_newly_set_premium():
    car = ensure_car_available("SA-006-AA")
    client.patch(f"/api/cars/{car['id']}", json=CLEAR)

    try:
        before = float(_get()["total_insurance_cost"])

        client.patch(
            f"/api/cars/{car['id']}",
            json={"insured_from": "2026-01-01", "insured_until": "2026-12-31", "insurance_cost": "123.45"},
        )

        after = float(_get()["total_insurance_cost"])
        assert round(after - before, 2) == 123.45
    finally:
        client.patch(f"/api/cars/{car['id']}", json=CLEAR)


def test_total_maintenance_spend_includes_a_completed_task():
    car = ensure_car_available("SA-006-AA")
    start = datetime.now(timezone.utc) + timedelta(days=600)

    before = float(_get()["total_maintenance_spend"])

    task = client.post(
        "/api/maintenance/tasks",
        json={
            "car_id": car["id"],
            "task_type": "MAINTENANCE",
            "category": "OTHER",
            "notes": None,
            "cost": "77.00",
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(hours=2)).isoformat(),
        },
    ).json()

    # An open task's estimate does not count yet.
    assert float(_get()["total_maintenance_spend"]) == before

    client.patch(f"/api/maintenance/tasks/{task['id']}/complete")

    after = float(_get()["total_maintenance_spend"])
    assert round(after - before, 2) == 77.00


def test_insurance_list_is_sorted_soonest_expiry_first_with_nulls_last():
    car = ensure_car_available("SA-006-AA")
    client.patch(f"/api/cars/{car['id']}", json=CLEAR)

    try:
        client.patch(
            f"/api/cars/{car['id']}",
            json={"insured_from": "2026-01-01", "insured_until": "2026-02-01", "insurance_cost": "10"},
        )

        data = _get()
        dates = [c["insured_until"] for c in data["insurance"]]
        with_dates = [d for d in dates if d is not None]
        assert with_dates == sorted(with_dates)

        # Every car without insured_until comes after every car with one.
        first_null = next((i for i, d in enumerate(dates) if d is None), len(dates))
        assert all(d is not None for d in dates[:first_null])
        assert all(d is None for d in dates[first_null:])
    finally:
        client.patch(f"/api/cars/{car['id']}", json=CLEAR)


def test_fleet_condition_needs_a_signed_in_user():
    from app.dependencies import get_current_user

    saved = app.dependency_overrides.pop(get_current_user, None)

    try:
        assert TestClient(app).get("/api/fleet-condition").status_code == 401
    finally:
        if saved is not None:
            app.dependency_overrides[get_current_user] = saved
