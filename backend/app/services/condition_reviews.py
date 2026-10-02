"""
An employee's optional reassessment of a car's condition at pickup or
return: tire condition plus exterior/interior photos. Never required to
proceed through check-in or check-out (see app/models/condition_review.py)
— this module exists so a car that has gone several rentals without anyone
actually looking it over can be flagged, the same way app/services/
fleet_condition.py flags an overdue oil change.

Photo bytes never touch this module directly beyond validation: they are
decoded, size/dimension-capped and re-encoded the same way
app/services/branding.py handles a logo upload, then handed to
app/services/photo_storage.py, which decides where they actually live.
"""

import base64
import binascii
import io
import re
import uuid
from datetime import datetime, timezone

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.errors import AppError, NotFoundError
from app.models import Car, ConditionPhoto, ConditionReview, Reservation, User
from app.services import photo_storage
from app.services.audit import audit_log

VALID_KINDS = ("CHECK_IN", "CHECK_OUT")
VALID_CATEGORIES = ("EXTERIOR", "INTERIOR")

# A condition photo is a real photo, not a small graphic like the business
# logo — the caps are correspondingly higher.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_DIMENSION = 1600
MAX_PIXELS = 40_000_000

_DATA_URL = re.compile(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$")


class InvalidPhoto(AppError):
    """A photo that cannot be used."""


def _decode(data_url: str) -> bytes:
    match = _DATA_URL.match(data_url.strip())

    if match is None:
        raise InvalidPhoto("condition_review.photo_wrong_type", "The photo must be a PNG or JPEG image.")

    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError):
        raise InvalidPhoto("condition_review.photo_corrupted", "The photo file is corrupted.")

    if len(raw) > MAX_UPLOAD_BYTES:
        raise InvalidPhoto(
            "condition_review.photo_too_large",
            f"The photo is too large. The limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            limit_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
        )

    return raw


def _normalize(raw: bytes) -> tuple[bytes, str]:
    """Decodes, downscales and re-encodes. Returns (bytes, content type)."""

    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("PNG", "JPEG"):
                raise InvalidPhoto("condition_review.photo_wrong_type", "The photo must be a PNG or JPEG image.")

            width, height = image.size

            if width * height > MAX_PIXELS:
                raise InvalidPhoto("condition_review.photo_dimensions_too_large", "The photo dimensions are too large.")

            image.load()
            image_format = image.format
            working = image.copy()
    except InvalidPhoto:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise InvalidPhoto("condition_review.photo_unreadable", "The photo file could not be read as an image.")

    working.thumbnail((MAX_DIMENSION, MAX_DIMENSION))

    out = io.BytesIO()

    if image_format == "JPEG":
        working.convert("RGB").save(out, format="JPEG", quality=88, optimize=True)
        return out.getvalue(), "image/jpeg"

    working.save(out, format="PNG", optimize=True)

    return out.getvalue(), "image/png"


def _get_reservation(db: Session, reservation_id: uuid.UUID) -> Reservation:
    reservation = db.get(Reservation, reservation_id)

    if reservation is None:
        raise NotFoundError("reservation.not_found", "Reservation not found.")

    return reservation


def _validate_kind(kind: str) -> None:
    if kind not in VALID_KINDS:
        raise AppError("condition_review.invalid_kind", "Invalid review kind.")


def get_review(db: Session, reservation_id: uuid.UUID, kind: str) -> ConditionReview | None:
    _validate_kind(kind)

    return db.scalar(
        select(ConditionReview)
        .options(joinedload(ConditionReview.photos))
        .where(ConditionReview.reservation_id == reservation_id, ConditionReview.kind == kind)
    )


def _get_or_create_review(db: Session, reservation_id: uuid.UUID, kind: str) -> ConditionReview:
    review = db.scalar(
        select(ConditionReview).where(
            ConditionReview.reservation_id == reservation_id, ConditionReview.kind == kind
        )
    )

    if review is None:
        review = ConditionReview(reservation_id=reservation_id, kind=kind)
        db.add(review)
        db.flush()

    return review


def save_tire_condition(
    db: Session,
    reservation_id: uuid.UUID,
    kind: str,
    tire_condition: str | None,
    actor: User,
) -> ConditionReview:
    _validate_kind(kind)

    if tire_condition is not None and tire_condition not in ("GOOD", "FAIR", "WORN", "NEEDS_REPLACEMENT"):
        raise AppError("condition_review.invalid_tire_condition", "Invalid tire condition.")

    reservation = _get_reservation(db, reservation_id)
    review = _get_or_create_review(db, reservation_id, kind)

    review.tire_condition = tire_condition
    review.reviewed_by = actor.id
    review.reviewed_at = datetime.now(timezone.utc)

    car = db.get(Car, reservation.car_id)
    car.tire_condition = tire_condition

    audit_log(
        db,
        user=actor,
        action="condition_review.tire_condition_recorded",
        entity_type="condition_review",
        entity_id=review.id,
        metadata={
            "reservation_id": str(reservation_id),
            "kind": kind,
            "car_id": str(car.id),
            "license_plate": car.license_plate,
            "tire_condition": tire_condition,
        },
    )

    db.commit()
    db.refresh(review)

    return review


def add_photo(
    db: Session,
    reservation_id: uuid.UUID,
    kind: str,
    category: str,
    data_url: str,
    actor: User,
) -> ConditionReview:
    _validate_kind(kind)

    if category not in VALID_CATEGORIES:
        raise AppError("condition_review.invalid_category", "Invalid photo category.")

    reservation = _get_reservation(db, reservation_id)
    review = _get_or_create_review(db, reservation_id, kind)

    content, content_type = _normalize(_decode(data_url))

    extension = "jpg" if content_type == "image/jpeg" else "png"
    blob_path = f"{reservation_id}/{kind}/{category}/{uuid.uuid4()}.{extension}"
    photo_storage.save(blob_path, content, content_type)

    photo = ConditionPhoto(
        condition_review_id=review.id,
        category=category,
        blob_path=blob_path,
        content_type=content_type,
    )
    db.add(photo)
    db.flush()

    audit_log(
        db,
        user=actor,
        action="condition_review.photo_added",
        entity_type="condition_review",
        entity_id=review.id,
        metadata={
            "reservation_id": str(reservation_id),
            "kind": kind,
            "category": category,
            "photo_id": str(photo.id),
            "bytes": len(content),
        },
    )

    db.commit()
    db.refresh(review)

    return review


def get_photo(db: Session, photo_id: uuid.UUID) -> ConditionPhoto:
    photo = db.get(ConditionPhoto, photo_id)

    if photo is None:
        raise NotFoundError("condition_review.photo_not_found", "Photo not found.")

    return photo


def read_photo_bytes(photo: ConditionPhoto) -> bytes:
    return photo_storage.read(photo.blob_path)


def last_n_completed_with_reviews(db: Session, car_id: uuid.UUID, n: int = 3) -> list[bool]:
    """For each of the car's last n COMPLETED reservations (newest first),
    whether it has a condition review (either kind) with a tire_condition
    recorded. Fewer than n completed reservations exist yet → a shorter
    list, which callers treat as "not enough history to judge"."""

    reservation_ids = db.scalars(
        select(Reservation.id)
        .where(Reservation.car_id == car_id, Reservation.status == "COMPLETED")
        .order_by(Reservation.return_at.desc())
        .limit(n)
    ).all()

    if not reservation_ids:
        return []

    reviewed_ids = set(
        db.scalars(
            select(ConditionReview.reservation_id).where(
                ConditionReview.reservation_id.in_(reservation_ids),
                ConditionReview.tire_condition.is_not(None),
            )
        ).all()
    )

    return [reservation_id in reviewed_ids for reservation_id in reservation_ids]


def condition_review_overdue(db: Session, car: Car, n: int = 3) -> bool:
    reviewed = last_n_completed_with_reviews(db, car.id, n)

    return len(reviewed) >= n and not any(reviewed)
