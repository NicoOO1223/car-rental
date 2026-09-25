"""Creates the DML-only database role the running app should use.

The admin login (used by migrations) owns the schema. The app itself only
needs to read and write rows, so a bug or injection in the app cannot drop
tables or change the schema.

Run once per stack, with the migrator connection, e.g. on Azure:

    az containerapp exec --name car-rental-backend --resource-group car-rental-rg \
        --command "python create_app_role.py <password>"

Reads MIGRATION_DATABASE_URL, or DATABASE_URL if that is unset. Safe to re-run:
it resets the password and re-applies the grants.
"""

import os
import sys

from sqlalchemy import create_engine, text

ROLE = "carrental_app"


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1]:
        sys.exit("Usage: python create_app_role.py <password>")
    password = sys.argv[1]

    url = os.getenv("MIGRATION_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        sys.exit("MIGRATION_DATABASE_URL or DATABASE_URL must be set.")

    engine = create_engine(url)
    with engine.begin() as conn:
        owner, database = conn.execute(
            text("SELECT current_user, current_database()")
        ).one()

        exists = conn.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": ROLE}
        ).first()
        # Role names and passwords cannot be bound parameters in DDL, so the
        # password goes through quote_literal on the server side.
        quoted = conn.execute(
            text("SELECT quote_literal(:p)"), {"p": password}
        ).scalar_one()
        verb = "ALTER" if exists else "CREATE"
        conn.execute(text(f"{verb} ROLE {ROLE} LOGIN PASSWORD {quoted}"))

        conn.execute(text(f'GRANT CONNECT ON DATABASE "{database}" TO {ROLE}'))
        conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {ROLE}"))
        conn.execute(
            text(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {ROLE}"
            )
        )
        conn.execute(
            text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {ROLE}")
        )
        # Tables created by later migrations (run as the owner) must be
        # usable by the app without another manual grant.
        conn.execute(
            text(
                f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA public "
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {ROLE}"
            )
        )
        conn.execute(
            text(
                f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA public "
                f"GRANT USAGE, SELECT ON SEQUENCES TO {ROLE}"
            )
        )

    print(f"Role {ROLE} is ready on {database} (schema owner: {owner}).")


if __name__ == "__main__":
    main()
