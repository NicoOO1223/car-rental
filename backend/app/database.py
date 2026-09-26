import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set")


# Verbose SQL logging is handy for local dev but noisy (and mildly
# leaky) in production logs, so it's opt-in via an env var there.
SQL_ECHO = os.getenv("SQL_ECHO", "false").lower() == "true"

# Sized for one small backend replica in front of a small Postgres server
# (a B1ms allows roughly 50 connections in total, shared with migrations and
# backups): up to 15 connections per replica.
DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "5"))
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "10"))

engine = create_engine(
    DATABASE_URL,
    echo=SQL_ECHO,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    # Fail a request that cannot get a connection after 10s instead of
    # hanging until the platform times it out.
    pool_timeout=10,
    # Azure closes idle connections and restarts the server for
    # maintenance. Testing a connection before use (and retiring old ones)
    # turns that from a burst of 500s into a transparent reconnect.
    pool_pre_ping=True,
    pool_recycle=1800,
    # A runaway query is cut off rather than holding a connection and CPU
    # on a burstable server. Migrations use their own engine (alembic/env.py).
    connect_args={"options": "-c statement_timeout=30000"},
)


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()