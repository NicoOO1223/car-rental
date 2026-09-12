from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import ensure_car_available, get_car_by_plate

client = TestClient(app)


def test_create_task_sets_car_status():
    car = ensure_car_available("SA-008-AA")

    response = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "notes": "Brake check"},
    )

    assert response.status_code == 200

    task = response.json()

    assert task["status"] == "OPEN"
    assert task["task_type"] == "MAINTENANCE"
    assert task["car"]["id"] == car["id"]

    updated_car = client.get(f"/api/cars/{car['id']}").json()
    assert updated_car["status"] == "MAINTENANCE"

    client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")


def test_create_task_rejects_second_open_task():
    car = ensure_car_available("SA-008-AA")

    first = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "CLEANING", "notes": None},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "notes": None},
    )
    assert second.status_code == 400

    client.patch(f"/api/maintenance/tasks/{first.json()['id']}/cancel")


def test_create_task_invalid_type():
    car = ensure_car_available("SA-008-AA")

    response = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "REPAIR", "notes": None},
    )

    assert response.status_code == 400


def test_create_task_car_not_found():
    response = client.post(
        "/api/maintenance/tasks",
        json={"car_id": str(uuid4()), "task_type": "MAINTENANCE", "notes": None},
    )

    assert response.status_code == 404


def test_complete_task_resets_car_to_available():
    car = ensure_car_available("SA-008-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "notes": None},
    ).json()

    response = client.patch(f"/api/maintenance/tasks/{task['id']}/complete")

    assert response.status_code == 200
    assert response.json()["status"] == "DONE"
    assert response.json()["completed_at"] is not None

    updated_car = client.get(f"/api/cars/{car['id']}").json()
    assert updated_car["status"] == "AVAILABLE"


def test_cancel_task_resets_car_and_records_cancelled():
    car = ensure_car_available("SA-008-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "CLEANING", "notes": None},
    ).json()

    response = client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"

    updated_car = client.get(f"/api/cars/{car['id']}").json()
    assert updated_car["status"] == "AVAILABLE"


def test_complete_already_closed_task_rejected():
    car = ensure_car_available("SA-008-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "notes": None},
    ).json()

    client.patch(f"/api/maintenance/tasks/{task['id']}/complete")

    second_attempt = client.patch(f"/api/maintenance/tasks/{task['id']}/complete")

    assert second_attempt.status_code == 400


def test_complete_task_not_found():
    response = client.patch(f"/api/maintenance/tasks/{uuid4()}/complete")

    assert response.status_code == 404


def test_list_tasks_filters_by_status_and_type():
    car = ensure_car_available("SA-008-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "CLEANING", "notes": "Filter test"},
    ).json()

    open_cleaning = client.get(
        "/api/maintenance/tasks", params={"status": "OPEN", "task_type": "CLEANING"}
    ).json()
    assert any(item["id"] == task["id"] for item in open_cleaning)

    open_maintenance = client.get(
        "/api/maintenance/tasks", params={"status": "OPEN", "task_type": "MAINTENANCE"}
    ).json()
    assert not any(item["id"] == task["id"] for item in open_maintenance)

    client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")

    still_open = client.get(
        "/api/maintenance/tasks", params={"status": "OPEN"}
    ).json()
    assert not any(item["id"] == task["id"] for item in still_open)

    cancelled = client.get(
        "/api/maintenance/tasks", params={"status": "CANCELLED"}
    ).json()
    assert any(item["id"] == task["id"] for item in cancelled)


def test_get_car_maintenance_tasks_history():
    car = ensure_car_available("SA-008-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "notes": None},
    ).json()
    client.patch(f"/api/maintenance/tasks/{task['id']}/complete")

    history = client.get(f"/api/cars/{car['id']}/maintenance-tasks")

    assert history.status_code == 200
    assert any(item["id"] == task["id"] for item in history.json())


def test_get_maintenance_tasks_for_unknown_car():
    response = client.get(f"/api/cars/{uuid4()}/maintenance-tasks")

    assert response.status_code == 404


def test_car_condition_fields_round_trip():
    car = get_car_by_plate("SA-005-AA")

    response = client.patch(
        f"/api/cars/{car['id']}",
        json={
            "mileage": 42000,
            "tire_condition": "FAIR",
            "last_oil_change_at": "2026-06-01",
        },
    )

    assert response.status_code == 200

    updated = response.json()
    assert updated["mileage"] == 42000
    assert updated["tire_condition"] == "FAIR"
    assert updated["last_oil_change_at"] == "2026-06-01"

    # Restore so this seeded car stays clean for other/future test runs.
    client.patch(
        f"/api/cars/{car['id']}",
        json={"mileage": None, "tire_condition": None, "last_oil_change_at": None},
    )


def test_car_condition_invalid_tire_condition_rejected():
    car = get_car_by_plate("SA-005-AA")

    response = client.patch(
        f"/api/cars/{car['id']}",
        json={"tire_condition": "BALD"},
    )

    assert response.status_code == 400
