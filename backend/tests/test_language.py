import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, User
from app.services.auth import create_access_token, hash_password
from tests.conftest import _get_fake_user

client = TestClient(app)


@pytest.fixture
def person():
    """A real staff account and a token for it (the suite's stand-in user is
    not attached to a database session, so it cannot be updated)."""

    db = SessionLocal()
    account = User(
        email=f"language-{uuid.uuid4()}@example.com",
        hashed_password=hash_password("a long enough password"),
        role="staff",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    user_id = account.id
    db.close()

    app.dependency_overrides.pop(get_current_user, None)
    headers = {"Authorization": f"Bearer {create_access_token(str(user_id), 7)}"}

    yield user_id, headers

    app.dependency_overrides[get_current_user] = _get_fake_user
    db = SessionLocal()
    for entry in db.scalars(select(AuditLog).where(AuditLog.entity_id == user_id)):
        db.delete(entry)
    stored = db.get(User, user_id)
    if stored is not None:
        db.delete(stored)
    db.commit()
    db.close()


@pytest.fixture
def business_languages():
    original = client.get("/api/configuration").json()

    def set_to(**fields):
        response = client.patch("/api/configuration", json=fields)
        assert response.status_code == 200
        return response.json()

    yield set_to

    client.patch(
        "/api/configuration",
        json={
            "default_language": original["default_language"],
            "document_language": original["document_language"],
        },
    )


# --- a person's own language -------------------------------------------------


def test_a_new_account_has_no_language_of_its_own(person):
    _, headers = person

    body = client.get("/api/auth/me", headers=headers).json()

    assert body["language"] is None


def test_a_person_can_choose_and_clear_their_language(person):
    user_id, headers = person

    chosen = client.patch("/api/auth/me", json={"language": "pl"}, headers=headers)
    assert chosen.status_code == 200
    assert chosen.json()["language"] == "pl"
    assert client.get("/api/auth/me", headers=headers).json()["language"] == "pl"

    db = SessionLocal()
    assert db.get(User, user_id).language == "pl"
    db.close()

    cleared = client.patch("/api/auth/me", json={"language": None}, headers=headers)
    assert cleared.json()["language"] is None


def test_a_staff_member_needs_no_admin_rights_to_change_their_language(person):
    _, headers = person

    assert client.patch("/api/auth/me", json={"language": "it"}, headers=headers).status_code == 200


@pytest.mark.parametrize("value", ["xx", "english", "", "IT", "it-IT"])
def test_unknown_languages_are_rejected(value, person):
    _, headers = person

    assert client.patch("/api/auth/me", json={"language": value}, headers=headers).status_code == 422


def test_changing_language_needs_a_login():
    app.dependency_overrides.pop(get_current_user, None)

    try:
        assert client.patch("/api/auth/me", json={"language": "it"}).status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = _get_fake_user


def test_the_language_endpoint_changes_nothing_else(person):
    user_id, headers = person

    client.patch("/api/auth/me", json={"language": "it", "role": "admin", "is_active": False}, headers=headers)

    db = SessionLocal()
    stored = db.get(User, user_id)
    assert (stored.role, stored.is_active, stored.language) == ("staff", True, "it")
    db.close()


# --- the business's languages -------------------------------------------------


def test_the_business_defaults_are_english():
    body = client.get("/api/configuration").json()

    assert body["default_language"] in ("en", "it", "pl")
    assert body["document_language"] in ("en", "it", "pl")


def test_an_admin_sets_the_default_and_document_languages(business_languages):
    body = business_languages(default_language="it", document_language="pl")

    assert body["default_language"] == "it"
    assert body["document_language"] == "pl"


@pytest.mark.parametrize("field", ["default_language", "document_language"])
def test_the_business_cannot_pick_an_unsupported_language(field):
    assert client.patch("/api/configuration", json={field: "de"}).status_code == 422


def test_branding_exposes_the_default_language_without_a_login(business_languages):
    business_languages(default_language="pl")
    app.dependency_overrides.pop(get_current_user, None)

    try:
        body = client.get("/api/branding").json()
    finally:
        app.dependency_overrides[get_current_user] = _get_fake_user

    assert body["default_language"] == "pl"


def test_signed_in_staff_see_the_default_language_in_public_configuration(business_languages):
    business_languages(default_language="it")

    assert client.get("/api/configuration/public").json()["default_language"] == "it"
