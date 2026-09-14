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

Prompts for the password (hidden input) if it isn't passed as the
second argument.
"""

import getpass
import sys

from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import User
from app.services.auth import hash_password


def create_staff_user(email: str, password: str):
    # Stored (and checked) lowercase so login's case-insensitive lookup
    # (see app/services/auth.py::authenticate_user) always has a
    # consistent value to match against, and so "Name@Example.com" can't
    # be created as a second account alongside an existing
    # "name@example.com".
    normalized_email = email.strip().lower()

    db = SessionLocal()

    try:
        existing = db.scalar(
            select(User).where(func.lower(User.email) == normalized_email)
        )

        if existing is not None:
            print(f"A user with email {normalized_email!r} already exists.")
            sys.exit(1)

        user = User(email=normalized_email, hashed_password=hash_password(password))
        db.add(user)
        db.commit()

        print(f"Created staff user: {normalized_email}")

    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python create_staff_user.py <email> [password]")
        sys.exit(1)

    email_arg = sys.argv[1]

    if len(sys.argv) >= 3:
        password_arg = sys.argv[2]
    else:
        password_arg = getpass.getpass("Password: ")

    create_staff_user(email_arg, password_arg)
