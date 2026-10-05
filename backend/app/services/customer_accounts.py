"""Renter accounts on the storefront: register, sign in, own bookings.

Tokens carry their own audience, so a staff login token is never accepted
here and an account token is never accepted by the staff API."""

import hashlib
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import SECRET_KEY
from app.database import get_db
from app.errors import AppError
from app.models import CustomerAccount, CustomerAccountBooking, Reservation
from app.services.auth import (
    LOCKOUT_MINUTES,
    MAX_FAILED_LOGINS,
    AccountLocked,
    hash_password,
    normalize_email,
    verify_password,
)

AUDIENCE = "storefront-account"
VERIFY_AUDIENCE = "storefront-account-verify"
RESET_AUDIENCE = "storefront-account-reset"
VERIFY_LIFETIME = timedelta(hours=24)
RESET_LIFETIME = timedelta(hours=1)
LIFETIME = timedelta(days=14)
_ALGORITHM = "HS256"

_DUMMY_HASH = hash_password("not-a-real-password")

bearer = HTTPBearer(auto_error=False)


def create_account_token(account_id: UUID) -> str:
    now = datetime.now(timezone.utc)

    return jwt.encode(
        # iat as a float: whole seconds would make a token issued in the same
        # second as a logout ambiguous.
        {"sub": str(account_id), "aud": AUDIENCE, "iat": time.time(), "exp": now + LIFETIME},
        SECRET_KEY,
        algorithm=_ALGORITHM,
    )


def _signed_out() -> AppError:
    return AppError("account.signed_out", "Please sign in again.", status_code=401)


def optional_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> CustomerAccount | None:
    """The signed-in renter, or None for a guest. A token that is present but
    bad is an error, not a silent guest: the caller thinks they are signed in."""

    if credentials is None or not credentials.credentials:
        return None

    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[_ALGORITHM], audience=AUDIENCE)
        account = db.get(CustomerAccount, UUID(payload["sub"]))
        issued_at = float(payload["iat"])
    except (jwt.PyJWTError, ValueError, KeyError, TypeError):
        raise _signed_out()

    if account is None:
        raise _signed_out()

    if account.token_valid_after is not None and issued_at < account.token_valid_after.timestamp():
        raise _signed_out()

    return account


def current_account(account: CustomerAccount | None = Depends(optional_account)) -> CustomerAccount:
    if account is None:
        raise _signed_out()

    return account


def register_account(
    db: Session, email: str, password: str, first_name: str, last_name: str, language: str | None = None
) -> CustomerAccount | None:
    """A new, unverified account; None when the address already has one. The caller
    must answer the same either way, or registering would reveal who has an account."""

    hashed = hash_password(password)
    address = normalize_email(email)

    if db.scalar(select(CustomerAccount.id).where(CustomerAccount.email == address)) is not None:
        return None

    account = CustomerAccount(
        email=address,
        hashed_password=hashed,
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        language=language,
    )
    db.add(account)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()

        return None

    db.refresh(account)

    return account


# --- proving the address, and forgetting the password ---------------------------------------------


def _fingerprint(account: CustomerAccount) -> str:
    """Changes whenever the password does, so a reset link works once."""

    return hashlib.sha256(account.hashed_password.encode()).hexdigest()[:16]


def _link_token(account: CustomerAccount, audience: str, lifetime: timedelta, **claims) -> str:
    return jwt.encode(
        {"sub": str(account.id), "aud": audience, "exp": datetime.now(timezone.utc) + lifetime, **claims},
        SECRET_KEY,
        algorithm=_ALGORITHM,
    )


def verification_token(account: CustomerAccount) -> str:
    return _link_token(account, VERIFY_AUDIENCE, VERIFY_LIFETIME, email=account.email)


def reset_token(account: CustomerAccount) -> str:
    return _link_token(account, RESET_AUDIENCE, RESET_LIFETIME, fp=_fingerprint(account))


def _account_for_link(db: Session, token: str, audience: str) -> tuple[CustomerAccount, dict]:
    bad = AppError("account.link_invalid", "This link has expired or is not valid. Ask for a new one.", status_code=400)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[_ALGORITHM], audience=audience)
        account = db.get(CustomerAccount, UUID(payload["sub"]))
    except (jwt.PyJWTError, ValueError, KeyError, TypeError):
        raise bad

    if account is None:
        raise bad

    return account, payload


def send_verification_email(db: Session, account: CustomerAccount) -> None:
    from app.services.email_outbox import queue_account_email

    if account.email_verified_at is None:
        queue_account_email(db, "verify_email", account, "verify", verification_token(account))
        db.commit()


def send_reset_email(db: Session, email: str) -> None:
    """Queues a reset link if the address has an account; says nothing either way."""

    from app.services.email_outbox import queue_account_email

    account = db.scalar(select(CustomerAccount).where(CustomerAccount.email == normalize_email(email)))

    if account is not None:
        queue_account_email(db, "reset_password", account, "reset-password", reset_token(account))
        db.commit()


def verify_email(db: Session, token: str) -> None:
    account, payload = _account_for_link(db, token, VERIFY_AUDIENCE)

    # A link for an address the account no longer has proves nothing.
    if payload.get("email") != account.email:
        raise AppError("account.link_invalid", "This link has expired or is not valid. Ask for a new one.", status_code=400)

    if account.email_verified_at is None:
        account.email_verified_at = datetime.now(timezone.utc)
        db.commit()


def reset_password(db: Session, token: str, password: str) -> None:
    account, payload = _account_for_link(db, token, RESET_AUDIENCE)

    if payload.get("fp") != _fingerprint(account):
        raise AppError("account.link_invalid", "This link has expired or is not valid. Ask for a new one.", status_code=400)

    now = datetime.now(timezone.utc)
    account.hashed_password = hash_password(password)
    # Every session ends; a reset also clears a lockout, and reading the mail proves the address.
    account.token_valid_after = now
    account.failed_login_count = 0
    account.locked_until = None

    if account.email_verified_at is None:
        account.email_verified_at = now

    db.commit()


def verified_account(account: CustomerAccount = Depends(current_account)) -> CustomerAccount:
    """For what an unverified address must not do: see or claim bookings."""

    if account.email_verified_at is None:
        raise AppError("account.email_not_verified", "Confirm your email address first.", status_code=403)

    return account


def authenticate_account(db: Session, email: str, password: str) -> CustomerAccount | None:
    """The account on success, None for any credential failure; raises
    AccountLocked while locked. Mirrors the staff login's lockout."""

    now = datetime.now(timezone.utc)
    account = db.scalar(select(CustomerAccount).where(CustomerAccount.email == normalize_email(email)))

    if account is None:
        verify_password(password, _DUMMY_HASH)
        return None

    if account.locked_until is not None and account.locked_until > now:
        raise AccountLocked(account)

    if account.locked_until is not None:
        account.locked_until = None
        account.failed_login_count = 0

    if not verify_password(password, account.hashed_password):
        account.failed_login_count += 1

        if account.failed_login_count >= MAX_FAILED_LOGINS:
            account.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)

        db.commit()

        if account.locked_until is not None:
            raise AccountLocked(account)

        return None

    account.failed_login_count = 0
    db.commit()

    return account


def sign_out_everywhere(db: Session, account: CustomerAccount) -> None:
    account.token_valid_after = datetime.now(timezone.utc)
    db.commit()


def link_booking(db: Session, account: CustomerAccount, reservation: Reservation) -> None:
    exists = db.scalar(
        select(func.count())
        .select_from(CustomerAccountBooking)
        .where(
            CustomerAccountBooking.account_id == account.id,
            CustomerAccountBooking.reservation_id == reservation.id,
        )
    )

    if not exists:
        db.add(CustomerAccountBooking(account_id=account.id, reservation_id=reservation.id))
        db.commit()


def account_reservations(db: Session, account: CustomerAccount) -> list[Reservation]:
    return list(
        db.scalars(
            select(Reservation)
            .join(CustomerAccountBooking, CustomerAccountBooking.reservation_id == Reservation.id)
            .where(CustomerAccountBooking.account_id == account.id, Reservation.public_reference.is_not(None))
            .order_by(Reservation.pickup_at.desc())
        )
    )


def owned_reservation(db: Session, account: CustomerAccount, reference: str) -> Reservation:
    """The account's booking with this reference. A booking that exists but
    belongs to someone else answers exactly like one that does not exist."""

    from app.services.public_booking import normalize_reference

    wanted = normalize_reference(reference)

    for reservation in account_reservations(db, account):
        if reservation.public_reference == wanted:
            return reservation

    raise AppError("public.booking_not_found", "We could not find a booking with that reference and email.", status_code=404)
