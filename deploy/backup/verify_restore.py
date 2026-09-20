"""Sanity-checks a just-restored database (run by the restore-drill job in
.github/workflows/db-backup.yml, against the throwaway postgres:16 service
container it restores a backup into — never against production).

alembic upgrade head (run before this script) only proves the schema is
still migratable; it passes fine against an empty database. This script
catches the failure mode that leaves: an empty or truncated dump that
restored "successfully" but has no data.

Run with DATABASE_URL pointed at the restored database.
"""

import sys

# Importing app.models registers every model's table on Base.metadata, so
# the expected table set is derived from the code, not a hand-maintained
# list that would silently drift as models are added.
from app.database import Base, engine
import app.models  # noqa: F401
from sqlalchemy import inspect, text


def main() -> None:
    expected_tables = set(Base.metadata.tables.keys())
    inspector = inspect(engine)
    actual_tables = set(inspector.get_table_names())

    missing = expected_tables - actual_tables
    if missing:
        print(f"FAIL: restored database is missing tables: {sorted(missing)}")
        sys.exit(1)

    total_rows = 0
    with engine.connect() as conn:
        for table in expected_tables:
            count = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one()
            total_rows += count

    if total_rows == 0:
        print("FAIL: restored database has all expected tables but zero rows across all of them")
        sys.exit(1)

    print(f"OK: {len(expected_tables)} tables present, {total_rows} total rows")


if __name__ == "__main__":
    main()
