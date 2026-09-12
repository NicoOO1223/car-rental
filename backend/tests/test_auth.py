from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import User
from app.services.auth import hash_password

client = TestClient(app)

TEST_EMAIL = "pytest-auth-test@example.com"
TEST_PASSWORD = "correct horse battery staple"


def _create_test_user():
    db = SessionLocal()

    try:
        user = User(email=TEST_EMAIL, hashed_password=hash_password(TEST_PASSWORD))
        db.add(user)
        db.commit()
        db.refresh(user)

        return user
    finally:
        db.close()


def _delete_test_user(user_id):
    db = SessionLocal()

    try:
        user = db.get(User, user_id)

        if user is not None:
            db.delete(user)
            db.commit()
    finally:
        db.close()


def test_login_success():
    user = _create_test_user()

    try:
        response = client.post(
            "/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )

        assert response.status_code == 200
        assert response.json()["token_type"] == "bearer"
        assert len(response.json()["access_token"]) > 0
    finally:
        _delete_test_user(user.id)


def test_login_wrong_password():
    user = _create_test_user()

    try:
        response = client.post(
            "/api/auth/login",
            json={"email": TEST_EMAIL, "password": "wrong password"},
        )

        assert response.status_code == 401
    finally:
        _delete_test_user(user.id)


def test_login_unknown_email():
    response = client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "whatever"},
    )

    assert response.status_code == 401


def test_protected_endpoint_rejects_missing_token():
    app.dependency_overrides.pop(get_current_user, None)

    response = client.get("/api/cars")

    assert response.status_code == 401


def test_protected_endpoint_rejects_garbage_token():
    app.dependency_overrides.pop(get_current_user, None)

    response = client.get(
        "/api/cars", headers={"Authorization": "Bearer not-a-real-token"}
    )

    assert response.status_code == 401


def test_protected_endpoint_accepts_valid_token():
    app.dependency_overrides.pop(get_current_user, None)
    user = _create_test_user()

    try:
        login = client.post(
            "/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )
        token = login.json()["access_token"]

        response = client.get(
            "/api/cars", headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
    finally:
        _delete_test_user(user.id)
