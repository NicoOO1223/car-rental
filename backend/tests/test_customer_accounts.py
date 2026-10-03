"""Renter accounts: register, sign in, sign out, and only their own bookings."""

import random
import uuid

import pytest

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.database import SessionLocal
from app.main import app
from app.models import Customer, Reservation
from app.services.auth import create_access_token
from tests import test_public_booking as helpers
from tests.test_public_booking import (  # noqa: F401  (fixtures)
    _book,
    fake_stripe,
    fresh_limits,
    storefront,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def _own_stretch_of_the_calendar(monkeypatch):
    # The booking helpers book the same car in windows that start at a random
    # day. Unpaid holds from earlier runs linger for a quarter of an hour, so
    # pick the start from a wider range to keep reruns from colliding.
    monkeypatch.setattr(helpers, "_first_day", random.randint(160, 320))

    yield

    # Release the holds this test took, so reruns do not hit the hold caps.
    db = SessionLocal()
    try:
        mine = select(Customer.id).where(Customer.email.like("renter-%@example.com"))
        db.execute(
            update(Reservation)
            .where(Reservation.status == "AWAITING_PAYMENT", Reservation.customer_id.in_(mine))
            .values(status="CANCELLED")
        )
        db.commit()
    finally:
        db.close()

PASSWORD = "correct horse battery"


def _ip():
    # A fresh address per booking: the hold caps count unpaid bookings per IP.
    return f"198.51.{random.randint(0, 255)}.{random.randint(1, 254)}"


def _email():
    return f"renter-{uuid.uuid4().hex[:10]}@example.com"


def _register(email=None, password=PASSWORD):
    email = email or _email()
    response = client.post(
        "/api/public/account/register",
        json={"email": email, "password": password, "first_name": "Ada", "last_name": "Lovelace"},
    )

    return email, response


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_returns_a_session(storefront):
    email, response = _register(email=f"Mixed.Case-{uuid.uuid4().hex[:8]}@Example.com")

    assert response.status_code == 201, response.text
    assert response.json()["account"]["email"] == email.lower()

    me = client.get("/api/public/account/me", headers=_auth(response.json()["access_token"]))

    assert me.status_code == 200
    assert me.json()["first_name"] == "Ada"


def test_duplicate_email_is_refused_whatever_the_case(storefront):
    email, first = _register(email=f"dup-{uuid.uuid4().hex[:8]}@example.com")

    assert first.status_code == 201

    _, second = _register(email=email.upper())

    assert second.status_code == 409
    assert second.json()["code"] == "account.email_taken"


def test_short_password_is_refused(storefront):
    _, response = _register(password="short")

    assert response.status_code == 422


def test_login_and_wrong_password(storefront):
    email, _ = _register()

    good = client.post("/api/public/account/login", json={"email": email.upper(), "password": PASSWORD})
    bad = client.post("/api/public/account/login", json={"email": email, "password": "nope-nope-nope"})
    unknown = client.post("/api/public/account/login", json={"email": _email(), "password": PASSWORD})

    assert good.status_code == 200
    assert bad.status_code == 401
    assert unknown.status_code == 401
    assert bad.json()["code"] == unknown.json()["code"] == "auth.invalid_credentials"


def test_account_locks_after_repeated_failures(storefront):
    email, _ = _register()

    for _ in range(5):
        client.post("/api/public/account/login", json={"email": email, "password": "wrong-password"})

    locked = client.post("/api/public/account/login", json={"email": email, "password": PASSWORD})

    assert locked.status_code == 429


def test_logout_ends_the_session(storefront):
    _, response = _register()
    token = response.json()["access_token"]

    assert client.post("/api/public/account/logout", headers=_auth(token)).status_code == 204
    assert client.get("/api/public/account/me", headers=_auth(token)).status_code == 401


def test_me_needs_a_valid_account_token(storefront):
    assert client.get("/api/public/account/me").status_code == 401
    assert client.get("/api/public/account/me", headers=_auth("garbage")).status_code == 401


def test_a_staff_token_is_not_an_account_token(storefront):
    staff_token = create_access_token(uuid.uuid4(), 1)

    assert client.get("/api/public/account/me", headers=_auth(staff_token)).status_code == 401


def test_booking_while_signed_in_lands_on_the_account(storefront, fake_stripe):
    _, session = _register()
    token = session.json()["access_token"]

    response, _, _ = _book_as(token)

    assert response.status_code == 201, response.text

    listed = client.get("/api/public/account/bookings", headers=_auth(token))

    assert [booking["reference"] for booking in listed.json()] == [response.json()["reference"]]


def test_registering_with_a_bookers_email_does_not_expose_their_bookings(storefront, fake_stripe):
    victim_email = _email()
    booked, _, _ = _book(email=victim_email, ip=_ip())

    assert booked.status_code == 201, booked.text

    # Addresses are not verified, so an attacker can register with the
    # victim's. They must still see nothing.
    _, session = _register(email=victim_email)
    listed = client.get("/api/public/account/bookings", headers=_auth(session.json()["access_token"]))

    assert listed.status_code == 200
    assert listed.json() == []


def test_claiming_a_booking_needs_reference_and_email(storefront, fake_stripe):
    booker = _email()
    booked, _, _ = _book(email=booker, ip=_ip(), plate="SA-005-AA")

    assert booked.status_code == 201, booked.text

    reference = booked.json()["reference"]
    _, session = _register()
    headers = _auth(session.json()["access_token"])

    wrong = client.post("/api/public/account/bookings/claim", json={"reference": reference, "email": _email()}, headers=headers)
    right = client.post("/api/public/account/bookings/claim", json={"reference": reference, "email": booker}, headers=headers)
    listed = client.get("/api/public/account/bookings", headers=headers)

    assert wrong.status_code == 404
    assert right.status_code == 200
    assert [booking["reference"] for booking in listed.json()] == [reference]


def test_an_account_can_open_its_own_booking_but_not_anothers(storefront, fake_stripe):
    mine, _, _ = _book(email=_email(), ip=_ip())

    assert mine.status_code == 201

    _, session = _register()
    headers = _auth(session.json()["access_token"])
    unauthenticated = client.post(f"/api/public/account/bookings/{mine.json()['reference']}/access")

    assert unauthenticated.status_code == 401
    assert client.post(f"/api/public/account/bookings/{mine.json()['reference']}/access", headers=headers).status_code == 404


def test_access_returns_a_working_manage_token(storefront, fake_stripe):
    booker = _email()
    booked, _, _ = _book(email=booker, ip=_ip())
    reference = booked.json()["reference"]
    _, session = _register()
    headers = _auth(session.json()["access_token"])

    client.post("/api/public/account/bookings/claim", json={"reference": reference, "email": booker}, headers=headers)

    access = client.post(f"/api/public/account/bookings/{reference}/access", headers=headers)

    assert access.status_code == 200, access.text

    shown = client.get(f"/api/public/bookings/{reference}", headers=_auth(access.json()["manage_token"]))

    assert shown.status_code == 200
    assert shown.json()["reference"] == reference


def _book_as(token):
    """A booking made with the account's token attached."""

    original = helpers.client.post

    def post(url, **kwargs):
        kwargs["headers"] = {**kwargs.get("headers", {}), **_auth(token)}

        return original(url, **kwargs)

    helpers.client.post = post

    try:
        return helpers._book(email=_email(), ip=_ip())
    finally:
        helpers.client.post = original
