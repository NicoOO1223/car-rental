from datetime import datetime, timedelta

import bcrypt
import jwt
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import SECRET_KEY
from app.models import User

JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        password.encode("utf-8"), hashed_password.encode("utf-8")
    )


def create_access_token(user_id, expire_days: int) -> str:
    """
    expire_days comes from configuration.access_token_expire_days
    (app/services/configuration.py). A token's exp claim is baked in at
    issue time, so changing this value only affects tokens issued
    afterward — it never shortens or extends a session already in
    progress.
    """

    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(days=expire_days),
    }

    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> str:
    """Returns the user id encoded in the token. Raises jwt.PyJWTError
    (caught by the caller) if the token is missing, malformed, expired,
    or signed with a different secret."""
    payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])

    return payload["sub"]


def normalize_email(email: str) -> str:
    # Case-insensitive on purpose: "Name@Example.com" and
    # "name@example.com" are the same mailbox, and a staff member
    # shouldn't get locked out over how their email client happened to
    # capitalize it. Used both to look up an existing account and to
    # store new/updated ones, so every code path agrees on one form.
    return email.strip().lower()


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    normalized_email = normalize_email(email)

    user = db.scalar(
        select(User).where(func.lower(User.email) == normalized_email)
    )

    if user is None or not verify_password(password, user.hashed_password):
        return None

    return user
