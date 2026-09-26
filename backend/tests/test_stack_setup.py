"""
First-run stack setup: the first administrator and the business profile,
applied only to a stack that has no administrator yet.

Each test runs inside a transaction that is rolled back, so the shared test
database is never changed.
"""

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.database import engine
from app.models import Configuration, Reservation, User
from app.services.stack_setup import (
    StackSetupError,
    apply_stack_setup,
    business_updates,
    generate_password,
)

BUSINESS = {
    "name": "Isola Noleggi",
    "currency": "eur",
    "timezone": "Europe/Rome",
    "locale": "it",
    "defaultLanguage": "it",
    "documentLanguage": "it",
    "vatRate": 22,
}


@pytest.fixture
def db():
    """A session whose commits are savepoints inside a transaction that is
    rolled back at the end."""

    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


def _no_administrators(db):
    db.execute(update(User).where(User.role == "admin").values(role="staff"))
    db.flush()


def test_a_stack_without_an_administrator_gets_one_and_its_profile(db):
    _no_administrators(db)

    # A fresh stack has no bookings. TRUNCATE is transactional in Postgres,
    # so this is undone with the rollback.
    db.execute(text("TRUNCATE reservations CASCADE"))

    result = apply_stack_setup(db, admin_email="Owner@Example.com", admin_password="a-good-password", business=BUSINESS)

    assert result.created_admin == "owner@example.com"
    assert "business_name" in result.applied

    admin = db.scalar(select(User).where(User.email == "owner@example.com"))
    assert admin.role == "admin"
    assert admin.hashed_password != "a-good-password"

    configuration = db.get(Configuration, 1)
    assert configuration.business_name == "Isola Noleggi"
    assert configuration.timezone == "Europe/Rome"
    assert configuration.default_language == "it"
    assert configuration.document_language == "it"


def test_a_stack_that_already_has_an_administrator_is_left_alone(db):
    before = db.get(Configuration, 1).business_name

    result = apply_stack_setup(db, admin_email="second@example.com", admin_password="a-good-password", business=BUSINESS)

    assert result.created_admin is None
    assert "already has an administrator" in result.skipped
    assert db.get(Configuration, 1).business_name == before
    assert db.scalar(select(User).where(User.email == "second@example.com")) is None


def test_a_stack_with_reservations_gets_its_administrator_but_keeps_its_profile(db):
    if db.scalar(select(Reservation.id).limit(1)) is None:
        pytest.skip("the shared test database has no reservations")

    _no_administrators(db)
    before = db.get(Configuration, 1).business_name

    result = apply_stack_setup(db, admin_email="owner@example.com", admin_password="a-good-password", business=BUSINESS)

    assert result.created_admin == "owner@example.com"
    assert result.applied == []
    assert "reservations" in result.skipped
    assert db.get(Configuration, 1).business_name == before


def test_a_mistyped_setting_or_value_is_an_error_not_a_silent_skip():
    with pytest.raises(StackSetupError, match="Unknown business setting"):
        business_updates({"nmae": "x"})

    with pytest.raises(ValueError):
        business_updates({"timezone": "Mars/Olympus"})

    with pytest.raises(ValueError):
        business_updates({"defaultLanguage": "xx"})


def test_generated_passwords_are_long_random_and_readable():
    passwords = {generate_password() for _ in range(50)}

    assert len(passwords) == 50
    assert all(len(p) == 20 and p.isalnum() for p in passwords)
    assert not any(set(p) & set("0OIl1") for p in passwords)
