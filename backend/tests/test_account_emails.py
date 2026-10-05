"""
Storefront account emails: confirming an address and resetting a password. Links
carry purpose-bound, expiring tokens; nothing reveals whether an address has an account.
"""

import re
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import SECRET_KEY
from app.database import SessionLocal
from app.main import app
from app.models import CustomerAccount, EmailMessage
from app.services import customer_accounts
from tests.test_customer_accounts import PASSWORD, _auth, _email  # noqa: F401
from tests.test_email_outbox import _clean_outbox, _messages, email_on  # noqa: F401
from tests.test_public_booking import fresh_limits, storefront  # noqa: F401

client = TestClient(app)

NEW_PASSWORD = "a brand new password"


@pytest.fixture(autouse=True)
def _storefront_address(monkeypatch):
    monkeypatch.setenv("STOREFRONT_URL", "https://shop.example.com")


def _sign_up(language: str | None = None):
    email = _email()
    body = {"email": email, "password": PASSWORD, "first_name": "Ada", "last_name": "Lovelace"}

    if language:
        body["language"] = language

    assert client.post("/api/public/account/register", json=body).status_code == 202

    return email


def _mail(template: str, email: str) -> list[EmailMessage]:
    return [m for m in _messages() if m.template == template and m.to_address == email.lower()]


def _token_in(message: EmailMessage) -> str:
    return re.search(r"#token=([\w.-]+)", message.body_text).group(1)


def _account(email: str) -> CustomerAccount:
    db = SessionLocal()
    try:
        account = db.scalar(select(CustomerAccount).where(CustomerAccount.email == email.lower()))
        db.expunge_all()

        return account
    finally:
        db.close()


# --- confirming the address ----------------------------------------------------------------------


def test_registering_sends_one_confirmation_in_the_pages_language_and_the_link_works(email_on, storefront):
    email = _sign_up("it")

    [message] = _mail("verify_email", email)

    assert message.language == "it"
    assert "https://shop.example.com/it/account/verify#token=" in message.body_text
    assert "24 ore" in message.body_text

    login = client.post("/api/public/account/login", json={"email": email, "password": PASSWORD}).json()
    headers = _auth(login["access_token"])

    assert login["account"]["email_verified"] is False
    assert client.get("/api/public/account/bookings", headers=headers).status_code == 403

    assert client.post("/api/public/account/verify", json={"token": _token_in(message)}).status_code == 200
    assert client.get("/api/public/account/bookings", headers=headers).status_code == 200
    assert client.get("/api/public/account/me", headers=headers).json()["email_verified"] is True

    # Following it again changes nothing.
    assert client.post("/api/public/account/verify", json={"token": _token_in(message)}).status_code == 200


def test_registering_an_existing_address_sends_nothing_new(email_on, storefront):
    email = _sign_up()

    assert (
        client.post(
            "/api/public/account/register",
            json={"email": email, "password": PASSWORD, "first_name": "Eve", "last_name": "X"},
        ).status_code
        == 202
    )

    assert len(_mail("verify_email", email)) == 1


def test_a_resend_is_held_back_for_a_couple_of_minutes_then_allowed(email_on, storefront):
    email = _sign_up()
    token = client.post("/api/public/account/login", json={"email": email, "password": PASSWORD}).json()["access_token"]

    assert client.post("/api/public/account/resend-verification", headers=_auth(token)).status_code == 200
    assert len(_mail("verify_email", email)) == 1

    db = SessionLocal()
    try:
        for row in db.scalars(select(EmailMessage).where(EmailMessage.to_address == email.lower())):
            row.created_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        db.commit()
    finally:
        db.close()

    assert client.post("/api/public/account/resend-verification", headers=_auth(token)).status_code == 200
    assert len(_mail("verify_email", email)) == 2


def test_a_verification_link_must_be_a_verification_link(storefront):
    email = _sign_up()
    account = _account(email)
    now = datetime.now(timezone.utc)

    def forge(**claims):
        return jwt.encode({"sub": str(account.id), "exp": now + timedelta(hours=1), **claims}, SECRET_KEY, algorithm="HS256")

    wrong_purpose = customer_accounts.reset_token(account)
    login_token = customer_accounts.create_account_token(account.id)
    expired = forge(aud=customer_accounts.VERIFY_AUDIENCE, email=account.email, exp=now - timedelta(minutes=1))
    other_address = forge(aud=customer_accounts.VERIFY_AUDIENCE, email="someone-else@example.com")

    for bad in (wrong_purpose, login_token, expired, other_address, "garbage-garbage"):
        response = client.post("/api/public/account/verify", json={"token": bad})

        assert response.status_code == 400 and response.json()["code"] == "account.link_invalid"

    assert _account(email).email_verified_at is None


# --- forgetting the password ---------------------------------------------------------------------


def test_a_reset_link_sets_a_new_password_once_and_ends_every_session(email_on, storefront):
    email = _sign_up("pl")
    session = client.post("/api/public/account/login", json={"email": email, "password": PASSWORD}).json()

    assert client.post("/api/public/account/forgot-password", json={"email": email.upper()}).status_code == 202

    [message] = _mail("reset_password", email)

    assert message.language == "pl"
    assert "https://shop.example.com/pl/account/reset-password#token=" in message.body_text

    token = _token_in(message)

    reset = client.post("/api/public/account/reset-password", json={"token": token, "password": NEW_PASSWORD})

    assert reset.status_code == 200, reset.text
    assert client.post("/api/public/account/login", json={"email": email, "password": PASSWORD}).status_code == 401
    assert client.post("/api/public/account/login", json={"email": email, "password": NEW_PASSWORD}).status_code == 200
    # The old session is over, and reading the mail proved the address.
    assert client.get("/api/public/account/me", headers=_auth(session["access_token"])).status_code == 401
    assert _account(email).email_verified_at is not None

    # The link works once.
    again = client.post("/api/public/account/reset-password", json={"token": token, "password": "yet another password"})

    assert again.status_code == 400 and again.json()["code"] == "account.link_invalid"


def test_asking_for_a_reset_does_not_reveal_whether_there_is_an_account(email_on, storefront):
    known = _sign_up()
    unknown = _email()

    a = client.post("/api/public/account/forgot-password", json={"email": known})
    b = client.post("/api/public/account/forgot-password", json={"email": unknown})

    assert (a.status_code, a.json()) == (b.status_code, b.json()) == (202, {"status": "check_email"})
    assert len(_mail("reset_password", known)) == 1
    assert _mail("reset_password", unknown) == []


def test_a_reset_clears_a_lockout(email_on, storefront):
    email = _sign_up()

    for _ in range(5):
        client.post("/api/public/account/login", json={"email": email, "password": "wrong-password"})

    assert client.post("/api/public/account/login", json={"email": email, "password": PASSWORD}).status_code == 429

    client.post("/api/public/account/forgot-password", json={"email": email})
    token = _token_in(_mail("reset_password", email)[0])

    assert client.post("/api/public/account/reset-password", json={"token": token, "password": NEW_PASSWORD}).status_code == 200
    assert client.post("/api/public/account/login", json={"email": email, "password": NEW_PASSWORD}).status_code == 200


def test_a_reset_link_cannot_confirm_an_address_and_a_short_password_is_refused(email_on, storefront):
    email = _sign_up()
    client.post("/api/public/account/forgot-password", json={"email": email})
    token = _token_in(_mail("reset_password", email)[0])

    assert client.post("/api/public/account/verify", json={"token": token}).status_code == 400
    assert client.post("/api/public/account/reset-password", json={"token": token, "password": "short"}).status_code == 422


def test_no_account_email_without_a_storefront_address(email_on, storefront, monkeypatch):
    monkeypatch.delenv("STOREFRONT_URL")
    email = _sign_up()

    assert _mail("verify_email", email) == []


def test_the_account_emails_cannot_be_switched_off_and_read_well_in_every_language():
    from app.i18n.email_templates import TEMPLATES
    from app.languages import SUPPORTED_LANGUAGES
    from app.services.email_render import Wording, render
    from app.services.email_types import SAMPLE_VALUES, TYPES

    for key in ("verify_email", "reset_password"):
        assert key in TEMPLATES
        assert TYPES[key].audience == "account" and TYPES[key].can_disable is False

        for language in SUPPORTED_LANGUAGES:
            rendered = render(Wording({}, {}), TYPES[key], language, {"business": "Sample", "contact": "", **SAMPLE_VALUES[key]})

            assert "{" not in rendered.text and "#token=" in rendered.text
