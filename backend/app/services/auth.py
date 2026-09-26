import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import SECRET_KEY
from app.models import User
from app.services.audit import audit_log

JWT_ALGORITHM = "HS256"

# Five wrong passwords lock the account for fifteen minutes. Short enough
# that a legitimate user is not stuck for long, long enough to make online
# guessing pointless.
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15


class AccountLocked(Exception):
    """Raised when login is refused because the account is temporarily
    locked."""

    def __init__(self, user: User):
        super().__init__("Account is temporarily locked.")
        self.user = user


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
        "exp": datetime.now(timezone.utc) + timedelta(days=expire_days),
        # A float on purpose: whole seconds would make a token issued in
        # the same second as a revocation ambiguous. Compared against
        # User.token_valid_after in get_current_user.
        "iat": time.time(),
    }

    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> tuple[str, float | None]:
    """Returns (user id, issued-at timestamp) from the token. The issued-at
    is None for tokens created before that claim existed. Raises
    jwt.PyJWTError (caught by the caller) if the token is missing,
    malformed, expired, or signed with a different secret."""
    payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])

    return payload["sub"], payload.get("iat")


def normalize_email(email: str) -> str:
    # Case-insensitive on purpose: "Name@Example.com" and
    # "name@example.com" are the same mailbox, and a staff member
    # shouldn't get locked out over how their email client happened to
    # capitalize it. Used both to look up an existing account and to
    # store new/updated ones, so every code path agrees on one form.
    return email.strip().lower()


# Checked against when the email is unknown, so a wrong email and a wrong
# password take about the same time and do not reveal which accounts exist.
_DUMMY_HASH = hash_password("not-a-real-password")


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    """Returns the user on success and None for any credential failure
    (unknown email, wrong password, deactivated account). Raises
    AccountLocked while the account is locked. Commits the failure counter
    itself, because the caller only ever sees a None for a failure."""
    normalized_email = normalize_email(email)
    now = datetime.now(timezone.utc)

    user = db.scalar(
        select(User).where(func.lower(User.email) == normalized_email)
    )

    if user is None:
        verify_password(password, _DUMMY_HASH)
        return None

    if user.locked_until is not None and user.locked_until > now:
        # Refused without checking the password, so a locked account cannot
        # be probed and correct guesses do not extend the lock.
        raise AccountLocked(user)

    if user.locked_until is not None:
        # The lock has expired: start counting from zero again.
        user.locked_until = None
        user.failed_login_attempts = 0

    if not verify_password(password, user.hashed_password):
        user.failed_login_attempts += 1

        if user.failed_login_attempts >= MAX_FAILED_LOGINS:
            user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            # No email or IP in the event: the entity id already says which
            # account, and the audit log should not hold more personal data
            # than it needs to.
            audit_log(
                db,
                user=user,
                action="user.login_locked",
                entity_type="user",
                entity_id=user.id,
                metadata={"attempts": user.failed_login_attempts},
            )

        db.commit()

        if user.locked_until is not None:
            raise AccountLocked(user)

        return None

    # A deactivated account is treated like a wrong password, so login does
    # not confirm that the account exists.
    if not user.is_active:
        db.commit()
        return None

    if user.failed_login_attempts or user.locked_until is not None:
        user.failed_login_attempts = 0
        user.locked_until = None

    db.commit()

    return user
