"""
One-off tool to create a staff login. There's no self-registration by
design (this is an internal admin tool), so accounts are created this
way — the same manual, explicitly-run-script convention as seed.py and
merge_duplicate_customers.py, not part of the app runtime.

Usage:
    python create_staff_user.py you@example.com
    python create_staff_user.py you@example.com "a-password"   # non-interactive,
                                                                  # e.g. via
                                                                  # `az containerapp exec`
    python create_staff_user.py you@example.com "a-password" --role admin

Prompts for the password (hidden input) if it isn't passed as the
second argument. --role defaults to "staff" (the least-privileged
role) if omitted — pass "--role admin" explicitly to create an
administrator, e.g. the first account in a fresh database.
"""

import getpass
import sys

from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import User
from app.models.user import VALID_ROLES
from app.services.auth import hash_password, normalize_email


def create_staff_user(email: str, password: str, role: str = "staff"):
    if role not in VALID_ROLES:
        print(f"Invalid role {role!r}. Must be one of: {', '.join(sorted(VALID_ROLES))}.")
        sys.exit(1)

    # Stored (and checked) lowercase so login's case-insensitive lookup
    # (see app/services/auth.py::authenticate_user) always has a
    # consistent value to match against, and so "Name@Example.com" can't
    # be created as a second account alongside an existing
    # "name@example.com".
    normalized_email = normalize_email(email)

    db = SessionLocal()

    try:
        existing = db.scalar(
            select(User).where(func.lower(User.email) == normalized_email)
        )

        if existing is not None:
            print(f"A user with email {normalized_email!r} already exists.")
            sys.exit(1)

        user = User(
            email=normalized_email,
            hashed_password=hash_password(password),
            role=role,
        )
        db.add(user)
        db.commit()

        print(f"Created {role} user: {normalized_email}")

    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]

    role_arg = "staff"

    if "--role" in args:
        role_index = args.index("--role")

        try:
            role_arg = args[role_index + 1]
        except IndexError:
            print("--role requires a value (admin or staff).")
            sys.exit(1)

        del args[role_index : role_index + 2]

    if len(args) < 1:
        print("Usage: python create_staff_user.py <email> [password] [--role admin|staff]")
        sys.exit(1)

    email_arg = args[0]

    if len(args) >= 2:
        password_arg = args[1]
    else:
        password_arg = getpass.getpass("Password: ")

    create_staff_user(email_arg, password_arg, role_arg)
