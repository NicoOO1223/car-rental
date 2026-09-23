import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import User
from app.services.audit import audit_log

client = TestClient(app)

_ADMIN_ID = uuid.UUID("00000000-0000-0000-0000-000000000000")


def _get_admin_user(db) -> User:
    return db.get(User, _ADMIN_ID)


def _make_marker() -> str:
    # A unique entity_type per test isolates it from every other test's
    # rows and from rows left behind by previous runs against this
    # persistent dev database — audit rows are never cleaned up, by
    # design, so tests must never assume an empty table.
    return f"test_audit_{uuid.uuid4().hex[:8]}"


def _write_row(*, action: str, entity_type: str, user=None, entity_id=None, metadata=None):
    db = SessionLocal()

    try:
        audit_log(
            db,
            user=user,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata=metadata,
        )
        db.commit()
    finally:
        db.close()


def test_audit_logs_rejects_staff_role():
    staff_user = User(
        id=_ADMIN_ID,
        email="test-suite@example.com",
        hashed_password="unused",
        role="staff",
        is_active=True,
    )

    app.dependency_overrides[get_current_user] = lambda: staff_user

    try:
        response = client.get("/api/audit-logs")

        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_audit_logs_actors_rejects_staff_role():
    staff_user = User(
        id=_ADMIN_ID,
        email="test-suite@example.com",
        hashed_password="unused",
        role="staff",
        is_active=True,
    )

    app.dependency_overrides[get_current_user] = lambda: staff_user

    try:
        response = client.get("/api/audit-logs/actors")

        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_audit_logs_lists_matching_entries_with_user_email():
    db = SessionLocal()

    try:
        admin = _get_admin_user(db)
    finally:
        db.close()

    marker = _make_marker()
    entity_id = uuid.uuid4()
    _write_row(
        action="reservation.cancelled",
        entity_type=marker,
        user=admin,
        entity_id=entity_id,
        metadata={"reason": "test"},
    )

    response = client.get("/api/audit-logs", params={"entity_type": marker})

    assert response.status_code == 200
    body = response.json()

    assert body["total"] == 1
    item = body["items"][0]
    assert item["user_id"] == str(admin.id)
    assert item["user_email"] == admin.email
    assert item["action"] == "reservation.cancelled"
    assert item["entity_type"] == marker
    assert item["entity_id"] == str(entity_id)
    assert item["details"] == {"reason": "test"}


def test_audit_logs_filters_by_action():
    marker = _make_marker()
    _write_row(action="reservation.cancelled", entity_type=marker)
    _write_row(action="reservation.status_changed", entity_type=marker)

    response = client.get(
        "/api/audit-logs",
        params={"entity_type": marker, "action": "reservation.cancelled"},
    )

    assert response.status_code == 200
    body = response.json()

    assert body["total"] == 1
    assert body["items"][0]["action"] == "reservation.cancelled"


def test_audit_logs_filters_by_user_id():
    db = SessionLocal()

    try:
        admin = _get_admin_user(db)
    finally:
        db.close()

    marker = _make_marker()
    _write_row(action="customer.viewed", entity_type=marker, user=admin)
    _write_row(action="customer.viewed", entity_type=marker, user=None)

    response = client.get(
        "/api/audit-logs",
        params={"entity_type": marker, "user_id": str(admin.id)},
    )

    assert response.status_code == 200
    body = response.json()

    assert body["total"] == 1
    assert body["items"][0]["user_id"] == str(admin.id)


def test_audit_logs_filters_by_date_range():
    marker = _make_marker()
    _write_row(action="customer.updated", entity_type=marker)

    today = datetime.now(timezone.utc).date()

    included = client.get(
        "/api/audit-logs",
        params={
            "entity_type": marker,
            "start_date": today.isoformat(),
            "end_date": today.isoformat(),
        },
    )
    assert included.status_code == 200
    assert included.json()["total"] == 1

    excluded = client.get(
        "/api/audit-logs",
        params={
            "entity_type": marker,
            "start_date": (today - timedelta(days=10)).isoformat(),
            "end_date": (today - timedelta(days=5)).isoformat(),
        },
    )
    assert excluded.status_code == 200
    assert excluded.json()["total"] == 0


def test_audit_logs_pagination():
    marker = _make_marker()
    _write_row(action="customer.updated", entity_type=marker)
    _write_row(action="customer.updated", entity_type=marker)
    _write_row(action="customer.updated", entity_type=marker)

    first_page = client.get(
        "/api/audit-logs",
        params={"entity_type": marker, "limit": 2, "offset": 0},
    )
    second_page = client.get(
        "/api/audit-logs",
        params={"entity_type": marker, "limit": 2, "offset": 2},
    )

    assert first_page.status_code == 200
    assert second_page.status_code == 200

    first_body = first_page.json()
    second_body = second_page.json()

    assert first_body["total"] == 3
    assert second_body["total"] == 3
    assert len(first_body["items"]) == 2
    assert len(second_body["items"]) == 1

    first_ids = {item["id"] for item in first_body["items"]}
    second_ids = {item["id"] for item in second_body["items"]}
    assert first_ids.isdisjoint(second_ids)


def test_audit_logs_actors_endpoint_lists_seen_users():
    db = SessionLocal()

    try:
        admin = _get_admin_user(db)
    finally:
        db.close()

    marker = _make_marker()
    _write_row(action="customer.updated", entity_type=marker, user=admin)

    response = client.get("/api/audit-logs/actors")

    assert response.status_code == 200
    emails = {actor["email"] for actor in response.json()}
    assert admin.email in emails
