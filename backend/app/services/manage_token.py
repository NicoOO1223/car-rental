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
LIFETIME = timedelta(minutes=60)
_ALGORITHM = "HS256"


def create_manage_token(reservation_id: UUID) -> str:
    now = datetime.now(timezone.utc)

    return jwt.encode(
        {"sub": str(reservation_id), "aud": AUDIENCE, "iat": now, "exp": now + LIFETIME},
        SECRET_KEY,
        algorithm=_ALGORITHM,
    )


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
