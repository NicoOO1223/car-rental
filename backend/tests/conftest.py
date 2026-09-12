import uuid

import pytest

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
)


def _get_fake_user():
    return _fake_user


@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[get_current_user] = _get_fake_user
    yield
    app.dependency_overrides.pop(get_current_user, None)
