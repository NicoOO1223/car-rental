import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, User
from app.services import login_throttle
from app.services.auth import (
    MAX_FAILED_LOGINS,
    create_access_token,
    hash_password,
)
from app.services.users import reset_password, update_user

client = TestClient(app)

PASSWORD = "correct horse battery staple"


@pytest.fixture(autouse=True)
def _fresh_ip_budget():
    login_throttle.reset()
    yield
    login_throttle.reset()


@pytest.fixture
def real_auth():
    """Runs the real get_current_user instead of the suite-wide override."""
    app.dependency_overrides.pop(get_current_user, None)
    yield


@pytest.fixture
def user():
    db = SessionLocal()
    account = User(
        email=f"login-security-{uuid.uuid4()}@example.com",
        hashed_password=hash_password(PASSWORD),
        role="staff",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    user_id = account.id
    db.close()

    yield account

    db = SessionLocal()
    for entry in db.scalars(select(AuditLog).where(AuditLog.entity_id == user_id)):
        db.delete(entry)
    stored = db.get(User, user_id)
    if stored is not None:
        db.delete(stored)
    db.commit()
    db.close()


@pytest.fixture
def admin():
    db = SessionLocal()
    account = User(
        email=f"login-security-admin-{uuid.uuid4()}@example.com",
        hashed_password=hash_password(PASSWORD),
        role="admin",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    admin_id = account.id
    db.close()

    yield account

    db = SessionLocal()
    for entry in db.scalars(select(AuditLog).where(AuditLog.user_id == admin_id)):
        db.delete(entry)
    stored = db.get(User, admin_id)
    if stored is not None:
        db.delete(stored)
    db.commit()
    db.close()


def _login(email, password):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def _stored(user_id) -> User:
    db = SessionLocal()
    try:
        stored = db.get(User, user_id)
        db.expunge(stored)
        return stored
    finally:
        db.close()


def _fail_logins(email, times):
    for _ in range(times):
        _login(email, "wrong")


# --- lockout ------------------------------------------------------------


def test_account_locks_after_repeated_wrong_passwords(user):
    for _ in range(MAX_FAILED_LOGINS - 1):
        assert _login(user.email, "wrong").status_code == 401

    # The fifth failure is the one that locks.
    assert _login(user.email, "wrong").status_code == 429

    # Even the right password is refused while locked.
    locked = _login(user.email, PASSWORD)
    assert locked.status_code == 429
    assert "Retry-After" in locked.headers


def test_lock_is_audited_without_personal_data(user):
    _fail_logins(user.email, MAX_FAILED_LOGINS)

    db = SessionLocal()
    try:
        events = list(
            db.scalars(
                select(AuditLog).where(
                    AuditLog.entity_id == user.id,
                    AuditLog.action == "user.login_locked",
                )
            )
        )
    finally:
        db.close()

    assert len(events) == 1
    assert events[0].details == {"attempts": MAX_FAILED_LOGINS}
    assert user.email not in str(events[0].details)


def test_successful_login_resets_the_failure_counter(user):
    _fail_logins(user.email, MAX_FAILED_LOGINS - 1)
    assert _login(user.email, PASSWORD).status_code == 200
    assert _stored(user.id).failed_login_attempts == 0

    # A fresh run of failures starts from zero, so this does not lock.
    _fail_logins(user.email, MAX_FAILED_LOGINS - 1)
    assert _login(user.email, PASSWORD).status_code == 200


def test_lock_expires(user):
    _fail_logins(user.email, MAX_FAILED_LOGINS)
    assert _login(user.email, PASSWORD).status_code == 429

    db = SessionLocal()
    stored = db.get(User, user.id)
    stored.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    db.close()

    assert _login(user.email, PASSWORD).status_code == 200
    assert _stored(user.id).failed_login_attempts == 0


def test_password_reset_clears_a_lock(user, admin):
    _fail_logins(user.email, MAX_FAILED_LOGINS)

    db = SessionLocal()
    reset_password(
        db,
        actor=db.get(User, admin.id),
        target_user=db.get(User, user.id),
        password="a brand new password",
    )
    db.close()

    assert _login(user.email, "a brand new password").status_code == 200


def test_unknown_email_and_wrong_password_look_the_same(user):
    unknown = _login(f"nobody-{uuid.uuid4()}@example.com", "whatever")
    wrong = _login(user.email, "wrong")

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_locked_and_unknown_accounts_get_the_same_rate_limit_answer(user):
    _fail_logins(user.email, MAX_FAILED_LOGINS)
    login_throttle.reset()

    locked = _login(user.email, "wrong")

    for _ in range(login_throttle.MAX_FAILURES_PER_IP):
        _login(f"nobody-{uuid.uuid4()}@example.com", "x")
    blocked_ip = _login(f"nobody-{uuid.uuid4()}@example.com", "x")

    assert locked.status_code == blocked_ip.status_code == 429
    assert locked.json() == blocked_ip.json()


def test_deactivated_account_cannot_log_in(user):
    db = SessionLocal()
    stored = db.get(User, user.id)
    stored.is_active = False
    db.commit()
    db.close()

    assert _login(user.email, PASSWORD).status_code == 401


# --- per-IP limit --------------------------------------------------------


def test_ip_is_blocked_after_too_many_failures():
    for _ in range(login_throttle.MAX_FAILURES_PER_IP):
        assert _login(f"nobody-{uuid.uuid4()}@example.com", "x").status_code == 401

    assert _login(f"nobody-{uuid.uuid4()}@example.com", "x").status_code == 429


def test_successful_logins_do_not_count_against_the_ip(user):
    for _ in range(login_throttle.MAX_FAILURES_PER_IP + 5):
        assert _login(user.email, PASSWORD).status_code == 200


# --- token revocation ----------------------------------------------------


def _get_cars(token):
    return client.get("/api/cars", headers={"Authorization": f"Bearer {token}"})


def _token(user_id):
    return create_access_token(str(user_id), 7)


def test_token_works_until_revoked(user, real_auth):
    assert _get_cars(_token(user.id)).status_code == 200


def test_password_reset_revokes_existing_tokens(user, admin, real_auth):
    old = _token(user.id)
    assert _get_cars(old).status_code == 200

    db = SessionLocal()
    reset_password(
        db,
        actor=db.get(User, admin.id),
        target_user=db.get(User, user.id),
        password="a brand new password",
    )
    db.close()

    assert _get_cars(old).status_code == 401
    # A token issued after the reset is fine.
    assert _get_cars(_token(user.id)).status_code == 200


def test_role_change_revokes_existing_tokens(user, admin, real_auth):
    old = _token(user.id)

    db = SessionLocal()
    update_user(
        db,
        actor=db.get(User, admin.id),
        target_user=db.get(User, user.id),
        role="admin",
    )
    db.close()

    assert _get_cars(old).status_code == 401


def test_deactivation_revokes_tokens_even_after_reactivation(user, admin, real_auth):
    old = _token(user.id)

    db = SessionLocal()
    actor = db.get(User, admin.id)
    target = db.get(User, user.id)
    update_user(db, actor=actor, target_user=target, is_active=False)
    update_user(db, actor=actor, target_user=target, is_active=True)
    db.close()

    assert _get_cars(old).status_code == 401
    assert _get_cars(_token(user.id)).status_code == 200


def test_unrelated_update_keeps_tokens_valid(user, admin, real_auth):
    old = _token(user.id)

    db = SessionLocal()
    update_user(
        db,
        actor=db.get(User, admin.id),
        target_user=db.get(User, user.id),
        hidden_nav_items=["/cars"],
    )
    db.close()

    assert _get_cars(old).status_code == 200


def test_token_without_issued_at_is_rejected_once_sessions_are_revoked(
    user, admin, real_auth
):
    import jwt

    from app.config import SECRET_KEY

    legacy = jwt.encode(
        {
            "sub": str(user.id),
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        },
        SECRET_KEY,
        algorithm="HS256",
    )

    # Before any revocation, tokens from before the claim existed still work.
    assert _get_cars(legacy).status_code == 200

    db = SessionLocal()
    reset_password(
        db,
        actor=db.get(User, admin.id),
        target_user=db.get(User, user.id),
        password="a brand new password",
    )
    db.close()

    assert _get_cars(legacy).status_code == 401

