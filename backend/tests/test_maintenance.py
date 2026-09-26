from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import ensure_car_available, get_car_by_plate

client = TestClient(app)


def window(start_hours: float = -1, duration_hours: float = 48) -> dict:
    """A maintenance window relative to now (by default: already under way)."""

    start = datetime.now(timezone.utc) + timedelta(hours=start_hours)

    return {
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(hours=duration_hours)).isoformat(),
    }


def test_create_task_marks_car_in_maintenance_now():
    car = ensure_car_available("SA-006-AA")

    response = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "category": "ROUTINE_SERVICE", "notes": "Brake check", **window()},
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
    car = ensure_car_available("SA-006-AA")

    first = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "CLEANING", "notes": None, **window()},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "category": "ROUTINE_SERVICE", "notes": None, **window()},
    )
    assert second.status_code == 400

    client.patch(f"/api/maintenance/tasks/{first.json()['id']}/cancel")


def test_create_task_invalid_type():
    car = ensure_car_available("SA-006-AA")

    response = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "REPAIR", "notes": None, **window()},
    )

    assert response.status_code == 400


def test_create_task_car_not_found():
    response = client.post(
        "/api/maintenance/tasks",
        json={"car_id": str(uuid4()), "task_type": "MAINTENANCE", "category": "ROUTINE_SERVICE", "notes": None, **window()},
    )

    assert response.status_code == 404


def test_complete_task_resets_car_to_available():
    car = ensure_car_available("SA-006-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "category": "ROUTINE_SERVICE", "notes": None, **window()},
    ).json()

    response = client.patch(f"/api/maintenance/tasks/{task['id']}/complete")

    assert response.status_code == 200
    assert response.json()["status"] == "DONE"
    assert response.json()["completed_at"] is not None

    updated_car = client.get(f"/api/cars/{car['id']}").json()
    assert updated_car["status"] == "AVAILABLE"


def test_cancel_task_resets_car_and_records_cancelled():
    car = ensure_car_available("SA-006-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "CLEANING", "notes": None, **window()},
    ).json()

    response = client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"

    updated_car = client.get(f"/api/cars/{car['id']}").json()
    assert updated_car["status"] == "AVAILABLE"


def test_complete_already_closed_task_rejected():
    car = ensure_car_available("SA-006-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "category": "ROUTINE_SERVICE", "notes": None, **window()},
    ).json()

    client.patch(f"/api/maintenance/tasks/{task['id']}/complete")

    second_attempt = client.patch(f"/api/maintenance/tasks/{task['id']}/complete")

    assert second_attempt.status_code == 400


def test_complete_task_not_found():
    response = client.patch(f"/api/maintenance/tasks/{uuid4()}/complete")

    assert response.status_code == 404


def test_list_tasks_filters_by_status_and_type():
    car = ensure_car_available("SA-006-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "CLEANING", "notes": "Filter test", **window()},
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
    car = ensure_car_available("SA-006-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "category": "ROUTINE_SERVICE", "notes": None, **window()},
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


def _audit_rows_for_task(task_id: str):
    from app.database import SessionLocal
    from app.models import AuditLog

    db = SessionLocal()

    try:
        return [
            (row.action, row.details)
            for row in db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "maintenance_task",
                AuditLog.entity_id == UUID(task_id),
            )
            .order_by(AuditLog.created_at)
            .all()
        ]
    finally:
        db.close()


def test_task_lifecycle_is_recorded_in_audit_log():
    car = ensure_car_available("SA-006-AA")
    notes = f"Brake check {uuid4().hex[:6]}"

    created = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "category": "ROUTINE_SERVICE", "notes": notes, **window()},
    ).json()

    completed = client.patch(f"/api/maintenance/tasks/{created['id']}/complete")
    assert completed.status_code == 200

    rows = _audit_rows_for_task(created["id"])

    assert [action for action, _ in rows] == [
        "maintenance_task.created",
        "maintenance_task.completed",
    ]
    assert rows[0][1]["notes"] == notes
    assert rows[0][1]["license_plate"] == "SA-006-AA"
    assert rows[0][1]["task_type"] == "MAINTENANCE"


def test_cancelled_task_is_recorded_in_audit_log():
    car = ensure_car_available("SA-006-AA")

    created = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "CLEANING", "notes": None, **window()},
    ).json()

    client.patch(f"/api/maintenance/tasks/{created['id']}/cancel")

    actions = [action for action, _ in _audit_rows_for_task(created["id"])]

    assert actions == [
        "maintenance_task.created",
        "maintenance_task.cancelled",
    ]


def _post_task(car_id, task_type="MAINTENANCE", **window_kwargs):
    return client.post(
        "/api/maintenance/tasks",
        json={
            "car_id": car_id,
            "task_type": task_type,
            "category": "ROUTINE_SERVICE" if task_type == "MAINTENANCE" else None,
            "notes": None,
            **window(**window_kwargs),
        },
    )


def test_create_task_requires_a_time_range():
    car = ensure_car_available("SA-006-AA")

    response = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "category": "ROUTINE_SERVICE", "notes": None},
    )

    assert response.status_code == 422


def test_create_task_rejects_end_before_start():
    car = ensure_car_available("SA-006-AA")

    response = _post_task(car["id"], start_hours=5, duration_hours=-2)

    assert response.status_code == 400
    assert "after start" in response.json()["detail"]


def test_create_task_rejects_window_already_over():
    car = ensure_car_available("SA-006-AA")

    response = _post_task(car["id"], start_hours=-10, duration_hours=2)

    assert response.status_code == 400
    assert "future" in response.json()["detail"]


def test_task_response_includes_window():
    car = ensure_car_available("SA-006-AA")

    response = _post_task(car["id"])
    task = response.json()

    assert task["starts_at"] is not None
    assert task["ends_at"] is not None

    client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")


def test_future_window_does_not_block_the_car_today():
    car = ensure_car_available("SA-006-AA")

    # Starts in 30 days: the car is fine today, blocked only then.
    task = _post_task(car["id"], start_hours=24 * 30, duration_hours=24).json()

    try:
        assert client.get(f"/api/cars/{car['id']}").json()["status"] == "AVAILABLE"
    finally:
        client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")


def test_window_blocks_new_reservations_for_that_period_only():
    car = ensure_car_available("SA-006-AA")
    location_id = car["current_location"]["id"]

    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=400)
    task = client.post(
        "/api/maintenance/tasks",
        json={
            "car_id": car["id"],
            "task_type": "MAINTENANCE", "category": "ROUTINE_SERVICE",
            "notes": None,
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(days=2)).isoformat(),
        },
    ).json()

    def book(pickup, return_):
        return client.post(
            "/api/reservations",
            json={
                "customer": {
                    "first_name": "Window",
                    "last_name": f"Test{uuid4().hex[:6]}",
                    "date_of_birth": "1990-01-01",
                    "address": "Window Street 1",
                    "postal_code": "1000AA",
                    "phone_number": f"+3161{uuid4().int % 10**7:07d}",
                    "email": f"window.{uuid4().hex[:6]}@example.com",
                },
                "car_id": car["id"],
                "pickup_location_id": location_id,
                "return_location_id": location_id,
                "pickup_at": pickup.isoformat(),
                "return_at": return_.isoformat(),
            },
        )

    try:
        overlapping = book(start + timedelta(days=1), start + timedelta(days=3))
        assert overlapping.status_code == 400
        assert "maintenance" in overlapping.json()["detail"]

        available = client.get(
            "/api/cars/available",
            params={
                "location_id": location_id,
                "pickup_at": (start + timedelta(days=1)).isoformat(),
                "return_at": (start + timedelta(days=3)).isoformat(),
            },
        ).json()
        assert car["id"] not in [item["id"] for item in available]

        outside = book(start + timedelta(days=5), start + timedelta(days=7))
        assert outside.status_code == 201
        client.patch(f"/api/reservations/{outside.json()['id']}/cancel")
    finally:
        client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")


def test_create_task_rejects_overlap_with_existing_reservation():
    car = ensure_car_available("SA-006-AA")
    location_id = car["current_location"]["id"]

    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=500)
    reservation = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Clash",
                "last_name": f"Test{uuid4().hex[:6]}",
                "date_of_birth": "1990-01-01",
                "address": "Clash Street 1",
                "postal_code": "1000AA",
                "phone_number": f"+3162{uuid4().int % 10**7:07d}",
                "email": f"clash.{uuid4().hex[:6]}@example.com",
            },
            "car_id": car["id"],
            "pickup_location_id": location_id,
            "return_location_id": location_id,
            "pickup_at": start.isoformat(),
            "return_at": (start + timedelta(days=3)).isoformat(),
        },
    ).json()

    try:
        response = client.post(
            "/api/maintenance/tasks",
            json={
                "car_id": car["id"],
                "task_type": "CLEANING",
                "notes": None,
                "starts_at": (start + timedelta(days=1)).isoformat(),
                "ends_at": (start + timedelta(days=2)).isoformat(),
            },
        )

        assert response.status_code == 400
        assert "reservation" in response.json()["detail"]
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_non_overlapping_windows_can_be_scheduled_for_the_same_car():
    car = ensure_car_available("SA-006-AA")

    first = _post_task(car["id"], start_hours=24 * 60, duration_hours=24)
    second = _post_task(car["id"], start_hours=24 * 70, duration_hours=24)

    try:
        assert first.status_code == 200
        assert second.status_code == 200
    finally:
        for response in (first, second):
            if response.status_code == 200:
                client.patch(f"/api/maintenance/tasks/{response.json()['id']}/cancel")


def _post_categorised(car_id, task_type, category, **window_kwargs):
    return client.post(
        "/api/maintenance/tasks",
        json={
            "car_id": car_id,
            "task_type": task_type,
            "category": category,
            "notes": None,
            **window(**window_kwargs),
        },
    )


def test_maintenance_task_requires_a_category():
    car = ensure_car_available("SA-006-AA")

    missing = _post_categorised(car["id"], "MAINTENANCE", None)
    assert missing.status_code == 400

    invalid = _post_categorised(car["id"], "MAINTENANCE", "WHATEVER")
    assert invalid.status_code == 400


def test_cleaning_task_cannot_have_a_category():
    car = ensure_car_available("SA-006-AA")

    response = _post_categorised(car["id"], "CLEANING", "OTHER")

    assert response.status_code == 400


def test_task_category_is_returned_and_audited():
    car = ensure_car_available("SA-006-AA")

    task = _post_categorised(car["id"], "MAINTENANCE", "DAMAGE_REPAIR").json()

    try:
        assert task["category"] == "DAMAGE_REPAIR"

        (action, details), = _audit_rows_for_task(task["id"])
        assert action == "maintenance_task.created"
        assert details["category"] == "DAMAGE_REPAIR"
    finally:
        client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")


def test_completing_inspection_requires_next_due_date():
    car = ensure_car_available("SA-006-AA")

    task = _post_categorised(car["id"], "MAINTENANCE", "TECHNICAL_INSPECTION").json()

    try:
        without = client.patch(f"/api/maintenance/tasks/{task['id']}/complete")
        assert without.status_code == 400
        assert "next technical inspection" in without.json()["detail"]

        in_the_past = client.patch(
            f"/api/maintenance/tasks/{task['id']}/complete",
            json={"next_inspection_due": "2020-01-01"},
        )
        assert in_the_past.status_code == 400

        # Neither attempt closed it.
        assert client.get(
            "/api/maintenance/tasks", params={"status": "OPEN"}
        ).json() and any(
            item["id"] == task["id"]
            for item in client.get(
                "/api/maintenance/tasks", params={"status": "OPEN"}
            ).json()
        )
    finally:
        client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")


def test_completing_inspection_updates_the_car_and_audit_log():
    car = ensure_car_available("SA-006-AA")
    next_due = (datetime.now(timezone.utc) + timedelta(days=730)).date()

    task = _post_categorised(car["id"], "MAINTENANCE", "TECHNICAL_INSPECTION").json()

    response = client.patch(
        f"/api/maintenance/tasks/{task['id']}/complete",
        json={"next_inspection_due": next_due.isoformat()},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "DONE"

    updated = client.get(f"/api/cars/{car['id']}").json()
    assert updated["last_inspection_at"] == datetime.now(timezone.utc).date().isoformat()
    assert updated["next_inspection_due"] == next_due.isoformat()

    actions = _audit_rows_for_task(task["id"])
    assert [action for action, _ in actions] == [
        "maintenance_task.created",
        "maintenance_task.completed",
    ]
    assert actions[1][1]["next_inspection_due"] == next_due.isoformat()


def test_completing_other_categories_leaves_inspection_dates_alone():
    car = ensure_car_available("SA-006-AA")
    before = client.get(f"/api/cars/{car['id']}").json()

    task = _post_categorised(car["id"], "MAINTENANCE", "DAMAGE_REPAIR").json()
    response = client.patch(f"/api/maintenance/tasks/{task['id']}/complete")

    assert response.status_code == 200

    after = client.get(f"/api/cars/{car['id']}").json()
    assert after["last_inspection_at"] == before["last_inspection_at"]
    assert after["next_inspection_due"] == before["next_inspection_due"]


def test_inspection_dates_are_editable_on_vehicle_condition():
    car = ensure_car_available("SA-006-AA")

    response = client.patch(
        f"/api/cars/{car['id']}",
        json={
            "last_inspection_at": "2026-01-15",
            "next_inspection_due": "2028-01-15",
        },
    )

    assert response.status_code == 200
    assert response.json()["last_inspection_at"] == "2026-01-15"
    assert response.json()["next_inspection_due"] == "2028-01-15"


# --- cost -----------------------------------------------------------------------


def test_a_task_can_carry_a_cost_that_completion_can_replace():
    car = ensure_car_available("SA-006-AA")

    task = client.post(
        "/api/maintenance/tasks",
        json={
            "car_id": car["id"],
            "task_type": "MAINTENANCE",
            "category": "ROUTINE_SERVICE",
            "notes": None,
            "cost": "120.50",
            **window(),
        },
    ).json()

    assert task["cost"] == "120.50"

    # Completing without a cost keeps the estimate.
    kept = client.patch(f"/api/maintenance/tasks/{task['id']}/complete", json={})
    assert kept.json()["cost"] == "120.50"

    second = client.post(
        "/api/maintenance/tasks",
        json={"car_id": car["id"], "task_type": "MAINTENANCE", "category": "OTHER", "notes": None, "cost": "50", **window()},
    ).json()
    final = client.patch(f"/api/maintenance/tasks/{second['id']}/complete", json={"cost": "64.90"})

    assert final.json()["cost"] == "64.90"


def test_a_task_without_a_cost_has_none_not_zero_and_a_negative_cost_is_rejected():
    car = ensure_car_available("SA-006-AA")

    payload = {"car_id": car["id"], "task_type": "MAINTENANCE", "category": "OTHER", "notes": None, **window()}
    rejected = client.post("/api/maintenance/tasks", json={**payload, "cost": "-1"})

    assert rejected.status_code == 422

    task = client.post("/api/maintenance/tasks", json=payload).json()

    assert task["cost"] is None

    client.patch(f"/api/maintenance/tasks/{task['id']}/cancel")


# --- insurance ------------------------------------------------------------------


def test_a_car_stores_its_insurance_period_and_cost():
    car = ensure_car_available("SA-006-AA")

    try:
        response = client.patch(
            f"/api/cars/{car['id']}",
            json={"insured_from": "2026-01-01", "insured_until": "2026-12-31", "insurance_cost": "480.00"},
        )

        assert response.status_code == 200
        assert response.json()["insured_from"] == "2026-01-01"
        assert response.json()["insured_until"] == "2026-12-31"
        assert response.json()["insurance_cost"] == "480.00"

        backwards = client.patch(
            f"/api/cars/{car['id']}", json={"insured_until": "2025-12-31"}
        )

        assert backwards.status_code == 400
        assert backwards.json()["code"] == "car.insurance_end_before_start"
    finally:
        client.patch(
            f"/api/cars/{car['id']}",
            json={"insured_from": None, "insured_until": None, "insurance_cost": None},
        )
