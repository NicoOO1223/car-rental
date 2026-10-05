"""
seed_marketing_demo.py builds a fictional business for the marketing screenshots.
It must be impossible to point it at a real database by accident, so its guards
are tested here. Importing the module is safe: it only imports the app inside main().
"""

import pytest

import seed_marketing_demo as seed

GOOD_URL = "postgresql+psycopg://user:pw@localhost:5432/car_rental_marketing_demo"


def _environment(monkeypatch, *, url=GOOD_URL, environment="development", secret="x"):
    monkeypatch.setenv("DATABASE_URL", url) if url else monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ENVIRONMENT", environment)
    monkeypatch.setenv("SECRET_KEY", secret) if secret else monkeypatch.delenv("SECRET_KEY", raising=False)


def test_runs_against_a_database_named_for_the_demo(monkeypatch):
    _environment(monkeypatch)

    seed.refuse_unless_safe()  # no exit


@pytest.mark.parametrize("environment", ["production", "Production", " PRODUCTION "])
def test_refuses_production(monkeypatch, environment):
    _environment(monkeypatch, environment=environment)

    with pytest.raises(SystemExit) as stopped:
        seed.refuse_unless_safe()

    assert "production" in str(stopped.value)


@pytest.mark.parametrize(
    "database",
    ["car_rental", "car_rental_test", "car_rental_marketing_demo_old", "marketing_demo", "customer_prod"],
)
def test_refuses_any_database_not_named_for_the_demo(monkeypatch, database):
    _environment(monkeypatch, url=f"postgresql+psycopg://user:pw@localhost:5432/{database}")

    with pytest.raises(SystemExit) as stopped:
        seed.refuse_unless_safe()

    assert "must end in" in str(stopped.value)


def test_refuses_without_a_database_url(monkeypatch):
    _environment(monkeypatch, url=None)

    with pytest.raises(SystemExit):
        seed.refuse_unless_safe()


def test_refuses_without_a_secret_key(monkeypatch):
    _environment(monkeypatch, secret=None)

    with pytest.raises(SystemExit):
        seed.refuse_unless_safe()


def test_the_demo_login_is_a_reserved_example_address():
    # Never a real person's address, and the stack it logs in to is throwaway.
    assert seed.ADMIN_EMAIL.endswith("@example.com")
