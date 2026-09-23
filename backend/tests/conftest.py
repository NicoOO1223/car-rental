import uuid

import pytest

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import User

# Every other test file in this suite predates authentication and
# exercises the API with no concept of a logged-in user. Rather than
# touching every one of them, auth is overridden to a fake user by
# default for the whole suite; test_auth.py explicitly removes this
# override for the specific tests that exercise real auth enforcement.
_fake_user = User(
    id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
    email="test-suite@example.com",
    hashed_password="unused",
    # admin, not staff: keeps the whole pre-existing suite (including the
    # now admin-gated revenue endpoint) passing without every test file
    # needing to know about roles. Role-specific behavior gets its own
    # dedicated tests that override this fixture.
    role="admin",
    is_active=True,
)


def _get_fake_user():
    return _fake_user


@pytest.fixture(scope="session", autouse=True)
def _ensure_fake_user_row():
    """
    created_by/updated_by and audit_logs.user_id are real foreign keys
    to users.id, so the fake user the whole suite authenticates as must
    actually exist as a row, not just live in memory as the dependency
    override below returns. Session-scoped and idempotent since this
    runs against the same persistent dev database across test runs.
    """

    db = SessionLocal()

    try:
        if db.get(User, _fake_user.id) is None:
            db.add(_fake_user)
            db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[get_current_user] = _get_fake_user
    yield
    app.dependency_overrides.pop(get_current_user, None)
