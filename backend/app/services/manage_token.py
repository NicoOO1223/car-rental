"""
The short-lived token that lets a renter act on one booking.

Issued when the booking is created and when it is looked up (reference plus
email). It has its own audience, so a staff login token is never accepted here
and a booking token is never accepted by the staff API (which decodes without an
audience and so rejects any token that carries one).
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt

from app.config import SECRET_KEY
from app.errors import AppError

AUDIENCE = "storefront-manage"
# A link in an email that lets the renter see one booking and pay its advance,
# and nothing else (it cannot cancel). Valid until the payment window closes.
PAY_AUDIENCE = "storefront-pay"
LIFETIME = timedelta(minutes=60)
_ALGORITHM = "HS256"


def create_manage_token(reservation_id: UUID) -> str:
    now = datetime.now(timezone.utc)

    return jwt.encode(
        {"sub": str(reservation_id), "aud": AUDIENCE, "iat": now, "exp": now + LIFETIME},
        SECRET_KEY,
        algorithm=_ALGORITHM,
    )


def create_pay_token(reservation_id: UUID, valid_until: datetime) -> str:
    now = datetime.now(timezone.utc)

    return jwt.encode(
        {"sub": str(reservation_id), "aud": PAY_AUDIENCE, "iat": now, "exp": valid_until},
        SECRET_KEY,
        algorithm=_ALGORITHM,
    )


def reservation_id_from_pay_or_manage_token(token: str | None) -> tuple[UUID, str]:
    """For the screens a payment link may open: (booking, which kind of token it was)."""

    invalid = AppError(
        "public.manage_token_invalid",
        "This link has expired. Look up your booking again.",
        status_code=401,
    )

    if not token:
        raise invalid

    for audience in (AUDIENCE, PAY_AUDIENCE):
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[_ALGORITHM], audience=audience)

            return UUID(payload["sub"]), audience
        except (jwt.PyJWTError, ValueError, KeyError):
            continue

    raise invalid


def reservation_id_from_token(token: str | None) -> UUID:
    invalid = AppError(
        "public.manage_token_invalid",
        "This link has expired. Look up your booking again.",
        status_code=401,
    )

    if not token:
        raise invalid

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[_ALGORITHM], audience=AUDIENCE)

        return UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise invalid
