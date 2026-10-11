"""
The short reference a renter quotes for a booking ("ABCD-2345").

Every booking has one, whether the renter made it on the website or staff made
it for them, so a renter can always look it up and be sent a link to it.
"""

import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

# No 0, O, 1, I or L: a reference is read out and typed in by people.
_REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def new_reference() -> str:
    letters = "".join(secrets.choice(_REFERENCE_ALPHABET) for _ in range(8))

    return f"{letters[:4]}-{letters[4:]}"


def normalize_reference(text: str) -> str:
    """What a renter typed, as stored: upper case with the dash in place."""

    compact = "".join(ch for ch in text.upper() if ch.isalnum())

    return f"{compact[:4]}-{compact[4:]}" if len(compact) == 8 else text.strip().upper()


def assign_reference(db: Session, reservation) -> str:
    """Gives the booking a reference if it has none, drawing again on the rare clash,
    and adds it to the session. Returns the reference."""

    if reservation.public_reference:
        return reservation.public_reference

    for _ in range(5):
        reservation.public_reference = new_reference()

        try:
            with db.begin_nested():
                db.add(reservation)
                db.flush()

            return reservation.public_reference
        except IntegrityError:
            continue

    reservation.public_reference = None

    from app.errors import AppError

    raise AppError("public.try_again", "Something went wrong. Please try again.", status_code=503)
