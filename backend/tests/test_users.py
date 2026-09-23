import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, User
from app.services.auth import hash_password

client = TestClient(app)

_ADMIN_ID = uuid.UUID("00000000-0000-0000-0000-000000000000")


def _make_email() -> str:
    return f"test-user-{uuid.uuid4().hex[:8]}@example.com"


def _delete_user(email: str):
    db = SessionLocal()

    try:
        user = db.query(User).filter(User.email == email).first()

        if user is not None:
            db.delete(user)
            db.commit()
    finally:
        db.close()


def _create_via_db(email: str, role: str = "staff", is_active: bool = True) -> User:
    db = SessionLocal()

    try:
        user = User(
            email=email,
            hashed_password=hash_password("original-password"),
            role=role,
            is_active=is_active,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


def _last_audit_row(*, entity_id, action: str) -> AuditLog | None:
    db = SessionLocal()

    try:
        return (
            db.query(AuditLog)
            .filter(AuditLog.entity_id == entity_id, AuditLog.action == action)
            .order_by(AuditLog.created_at.desc())
            .first()
        )
    finally:
        db.close()


def _as_staff():
    staff_user = User(
        id=_ADMIN_ID,
        email="test-suite@example.com",
        hashed_password="unused",
        role="staff",
        is_active=True,
    )
    app.dependency_overrides[get_current_user] = lambda: staff_user


def _restore_admin_override():
    app.dependency_overrides.pop(get_current_user, None)


# --- 403 for staff on every endpoint ---------------------------------


def test_list_users_rejects_staff_role():
    _as_staff()
    try:
        response = client.get("/api/users")
        assert response.status_code == 403
    finally:
        _restore_admin_override()


def test_create_user_rejects_staff_role():
    _as_staff()
    try:
        response = client.post(
            "/api/users",
            json={"email": _make_email(), "password": "a-password", "role": "staff"},
        )
        assert response.status_code == 403
    finally:
        _restore_admin_override()


def test_update_user_rejects_staff_role():
    target = _create_via_db(_make_email())
    _as_staff()
    try:
        response = client.patch(f"/api/users/{target.id}", json={"role": "admin"})
        assert response.status_code == 403
    finally:
        _restore_admin_override()
        _delete_user(target.email)


def test_reset_password_rejects_staff_role():
    target = _create_via_db(_make_email())
    _as_staff()
    try:
        response = client.post(
            f"/api/users/{target.id}/reset-password",
            json={"password": "a-new-password"},
        )
        assert response.status_code == 403
    finally:
        _restore_admin_override()
        _delete_user(target.email)


# --- create -----------------------------------------------------------


def test_create_user_success_records_audit_log():
    email = _make_email()

    try:
        response = client.post(
            "/api/users",
            json={"email": email, "password": "a-password", "role": "staff"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["email"] == email
        assert body["role"] == "staff"
        assert body["is_active"] is True

        row = _last_audit_row(entity_id=uuid.UUID(body["id"]), action="user.created")
        assert row is not None
        assert row.details == {"email": email, "role": "staff"}
    finally:
        _delete_user(email)


def test_create_user_duplicate_email_rejected():
    email = _make_email()
    first = client.post(
        "/api/users", json={"email": email, "password": "a-password", "role": "staff"}
    )
    assert first.status_code == 200

    try:
        response = client.post(
            "/api/users",
            json={"email": email.upper(), "password": "a-password", "role": "staff"},
        )
        assert response.status_code == 400
    finally:
        _delete_user(email)


def test_create_user_invalid_role_rejected():
    response = client.post(
        "/api/users",
        json={"email": _make_email(), "password": "a-password", "role": "superuser"},
    )
    assert response.status_code == 422


def test_create_user_short_password_rejected():
    response = client.post(
        "/api/users",
        json={"email": _make_email(), "password": "short", "role": "staff"},
    )
    assert response.status_code == 422


# --- update -------------------------------------------------------------


def test_update_user_role_change_records_audit_log():
    target = _create_via_db(_make_email(), role="staff")

    try:
        response = client.patch(f"/api/users/{target.id}", json={"role": "admin"})

        assert response.status_code == 200
        assert response.json()["role"] == "admin"

        row = _last_audit_row(entity_id=target.id, action="user.role_changed")
        assert row is not None
        assert row.details == {"old": "staff", "new": "admin"}
    finally:
        _delete_user(target.email)


def test_deactivate_user_records_audit_log_and_blocks_login():
    target = _create_via_db(_make_email())

    try:
        response = client.patch(f"/api/users/{target.id}", json={"is_active": False})

        assert response.status_code == 200
        assert response.json()["is_active"] is False

        row = _last_audit_row(entity_id=target.id, action="user.deactivated")
        assert row is not None

        app.dependency_overrides.pop(get_current_user, None)
        try:
            from app.services.auth import create_access_token

            token = create_access_token(str(target.id), 7)
            check = client.get(
                "/api/cars", headers={"Authorization": f"Bearer {token}"}
            )
            assert check.status_code == 401
        finally:
            _restore_admin_override()
    finally:
        _delete_user(target.email)


def test_reactivate_user_records_audit_log():
    target = _create_via_db(_make_email(), is_active=False)

    try:
        response = client.patch(f"/api/users/{target.id}", json={"is_active": True})

        assert response.status_code == 200
        assert response.json()["is_active"] is True

        row = _last_audit_row(entity_id=target.id, action="user.activated")
        assert row is not None
    finally:
        _delete_user(target.email)


def test_update_user_email_change_records_audit_log():
    target = _create_via_db(_make_email())
    new_email = _make_email()

    try:
        response = client.patch(f"/api/users/{target.id}", json={"email": new_email})

        assert response.status_code == 200
        assert response.json()["email"] == new_email

        row = _last_audit_row(entity_id=target.id, action="user.email_changed")
        assert row is not None
        assert row.details == {"old": target.email, "new": new_email}
    finally:
        _delete_user(new_email)


def test_update_user_hidden_nav_items_records_audit_log():
    target = _create_via_db(_make_email())

    try:
        response = client.patch(
            f"/api/users/{target.id}",
            json={"hidden_nav_items": ["/maintenance", "/cars"]},
        )

        assert response.status_code == 200
        assert sorted(response.json()["hidden_nav_items"]) == ["/cars", "/maintenance"]

        row = _last_audit_row(entity_id=target.id, action="user.visibility_changed")
        assert row is not None
        assert row.details["old"] == []
        assert sorted(row.details["new"]) == ["/cars", "/maintenance"]
    finally:
        _delete_user(target.email)


def test_update_user_not_found_returns_404():
    response = client.patch(f"/api/users/{uuid.uuid4()}", json={"role": "admin"})
    assert response.status_code == 404


def test_self_deactivation_blocked():
    response = client.patch(f"/api/users/{_ADMIN_ID}", json={"is_active": False})

    assert response.status_code == 400
    assert response.json()["detail"] == "You cannot deactivate your own account."


def test_self_role_change_blocked():
    response = client.patch(f"/api/users/{_ADMIN_ID}", json={"role": "staff"})

    assert response.status_code == 400
    assert response.json()["detail"] == "You cannot change your own role."


# --- reset password -------------------------------------------------------


def test_reset_password_then_login_with_new_password():
    target = _create_via_db(_make_email())

    try:
        response = client.post(
            f"/api/users/{target.id}/reset-password",
            json={"password": "a-brand-new-password"},
        )
        assert response.status_code == 200

        row = _last_audit_row(entity_id=target.id, action="user.password_reset")
        assert row is not None
        assert row.details is None

        app.dependency_overrides.pop(get_current_user, None)
        try:
            login = client.post(
                "/api/auth/login",
                json={"email": target.email, "password": "a-brand-new-password"},
            )
            assert login.status_code == 200
        finally:
            _restore_admin_override()
    finally:
        _delete_user(target.email)


def test_reset_password_short_password_rejected():
    target = _create_via_db(_make_email())

    try:
        response = client.post(
            f"/api/users/{target.id}/reset-password",
            json={"password": "short"},
        )
        assert response.status_code == 422
    finally:
        _delete_user(target.email)
