import pytest

from app.database import SessionLocal
from app.models import User
from create_staff_user import create_staff_user


def _delete_by_email(email: str):
    db = SessionLocal()

    try:
        user = db.query(User).filter(User.email == email.strip().lower()).first()

        if user is not None:
            db.delete(user)
            db.commit()
    finally:
        db.close()


def test_create_staff_user_stores_email_lowercase():
    email = "Some.Staff@Example.com"

    try:
        create_staff_user(email, "a-password")

        db = SessionLocal()
        try:
            stored = db.query(User).filter(User.email == "some.staff@example.com").first()
            assert stored is not None
        finally:
            db.close()
    finally:
        _delete_by_email(email)


def test_create_staff_user_rejects_a_case_variant_duplicate():
    """
    A row already exists as "dup@example.com"; asking to create
    "Dup@Example.com" must be recognized as the same address rather
    than colliding with the database's own unique constraint (or worse,
    silently succeeding and creating two accounts for one mailbox).
    """

    create_staff_user("dup@example.com", "first-password")

    try:
        with pytest.raises(SystemExit):
            create_staff_user("Dup@Example.com", "second-password")

        db = SessionLocal()
        try:
            count = db.query(User).filter(User.email == "dup@example.com").count()
            assert count == 1
        finally:
            db.close()
    finally:
        _delete_by_email("dup@example.com")
