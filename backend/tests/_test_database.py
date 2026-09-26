"""
Points the test suite at its own database, and makes sure it is ready.

The suite used to run against whatever DATABASE_URL said, which locally is
the dev database (shared with manual testing, so every run left rows behind
and stale rows caused failures elsewhere) and could just as easily have been
a real one. This module must be imported before anything from `app`, because
app.database reads DATABASE_URL once at import time.

What it does:
  1. Picks the test database: TEST_DATABASE_URL if set, otherwise DATABASE_URL
     with "_test" appended to the database name.
  2. Refuses to continue unless the name ends in "_test".
  3. Creates that database if missing (RESET_TEST_DB=1 drops and recreates it
     for a clean slate), applies every migration, and seeds the reference
     data if the database has none.
"""

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

BACKEND_DIR = Path(__file__).resolve().parent.parent

# The variable pytest is started with wins over the file, as everywhere else.
load_dotenv(BACKEND_DIR / ".env")


def _test_url() -> URL:
    explicit = os.environ.get("TEST_DATABASE_URL")
    source = explicit or os.environ.get("DATABASE_URL")

    if not source:
        pytest.exit(
            "Neither TEST_DATABASE_URL nor DATABASE_URL is set.", returncode=2
        )

    url = make_url(source)

    if not (url.database or "").endswith("_test"):
        if explicit:
            pytest.exit(
                f"TEST_DATABASE_URL points at '{url.database}'. The test suite "
                "deletes and rewrites data, so the database name must end in "
                "'_test'.",
                returncode=2,
            )

        url = url.set(database=f"{url.database}_test")

    return url


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _create_database(url: URL) -> None:
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")

    try:
        with admin.connect() as conn:
            if os.environ.get("RESET_TEST_DB") == "1":
                conn.execute(
                    text(f"DROP DATABASE IF EXISTS {_quote(url.database)} WITH (FORCE)")
                )

            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": url.database},
            ).first()

            if not exists:
                conn.execute(text(f"CREATE DATABASE {_quote(url.database)}"))
    finally:
        admin.dispose()


def _migrate() -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(config, "head")


def _seed_if_empty() -> None:
    from sqlalchemy import func, select

    from app.database import SessionLocal
    from app.models import Location
    from seed import seed

    db = SessionLocal()

    try:
        empty = db.scalar(select(func.count(Location.id))) == 0
    finally:
        db.close()

    if empty:
        seed()


def prepare() -> None:
    url = _test_url()

    # Everything that imports app.database from here on sees the test database.
    os.environ["DATABASE_URL"] = url.render_as_string(hide_password=False)

    try:
        _create_database(url)
    except Exception as exc:
        pytest.exit(
            f"Could not create or reach the test database '{url.database}': {exc}",
            returncode=2,
        )

    _migrate()
    _seed_if_empty()
