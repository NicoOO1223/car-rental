import uuid

import pytest

# Must run before anything from `app` is imported: it switches DATABASE_URL to
# the isolated test database (see tests/_test_database.py).
from tests import _test_database

_test_database.prepare()

from app.database import SessionLocal  # noqa: E402
from app.dependencies import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402

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

            # commit() expires every attribute on _fake_user by default
            # (expire_on_commit=True), so the very next access anywhere
            # in the suite would try to lazily refresh it — but this
            # session is closed by then, so on a genuinely fresh
            # database (this add+commit branch actually running, unlike
            # against the persistent local dev DB where the row already
            # exists and this whole branch is skipped) that raises
            # DetachedInstanceError. expunge() after a refresh detaches
            # it with its attributes already fully loaded in memory
            # instead, matching how it behaves when this branch never
            # runs at all.
            db.refresh(_fake_user)
            db.expunge(_fake_user)
    finally:
        db.close()


@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[get_current_user] = _get_fake_user
    yield
    app.dependency_overrides.pop(get_current_user, None)
