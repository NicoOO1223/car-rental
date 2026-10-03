"""
A car's photo: validating an upload, storing it, and reading it back.

A real photo, not a small graphic — the same caps and validate-then-
reencode approach as app/services/landing_hero.py, just keyed by car
rather than being a singleton. The bytes live in blob storage (or local
disk in dev/test) via app/services/photo_storage.py, in its own
"car-photos" container.
"""

import base64
import binascii
import io
import re
from datetime import datetime, timezone

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.errors import AppError, NotFoundError
from app.models import Car, User
from app.services import photo_storage
from app.services.audit import audit_log

CONTAINER_NAME = "car-photos"

MAX_UPLOAD_BYTES = 3 * 1024 * 1024
MAX_DIMENSION = 1920
MAX_PIXELS = 60_000_000

_DATA_URL = re.compile(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$")


class InvalidCarPhoto(AppError):
    """A car photo that cannot be used. An AppError, so the interface shows the reason in the user's language."""


def _decode(data_url: str) -> bytes:
    match = _DATA_URL.match(data_url.strip())

    if match is None:
        raise InvalidCarPhoto("car_photo.wrong_type", "The photo must be a PNG or JPEG image.")

    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError):
        raise InvalidCarPhoto("car_photo.corrupted", "The photo file is corrupted.")

    if len(raw) > MAX_UPLOAD_BYTES:
        raise InvalidCarPhoto(
            "car_photo.too_large",
            f"The photo is too large. The limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            limit_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
        )

    return raw


def _normalize(raw: bytes) -> tuple[bytes, str]:
    """Decodes, downscales and re-encodes. Returns (bytes, content type)."""

    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("PNG", "JPEG"):
                raise InvalidCarPhoto("car_photo.wrong_type", "The photo must be a PNG or JPEG image.")

            width, height = image.size

            if width * height > MAX_PIXELS:
                raise InvalidCarPhoto("car_photo.dimensions_too_large", "The photo dimensions are too large.")

            image.load()
            image_format = image.format
            working = image.copy()
    except InvalidCarPhoto:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise InvalidCarPhoto("car_photo.unreadable", "The photo file could not be read as an image.")

    working.thumbnail((MAX_DIMENSION, MAX_DIMENSION))

    out = io.BytesIO()

    if image_format == "JPEG":
        working.convert("RGB").save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue(), "image/jpeg"

    working.save(out, format="PNG", optimize=True)

    return out.getvalue(), "image/png"


def _blob_path(car_id, content_type: str) -> str:
    extension = "png" if content_type == "image/png" else "jpg"
    return f"{car_id}.{extension}"


def _get_car(db: Session, car_id) -> Car:
    car = db.get(Car, car_id)

    if car is None:
        raise NotFoundError("car.not_found", "Car not found.")

    return car


def read_car_photo(car: Car) -> bytes:
    return photo_storage.read(car.photo_blob_path, container=CONTAINER_NAME)


def set_car_photo(db: Session, *, car_id, actor: User, data_url: str) -> Car:
    car = _get_car(db, car_id)

    content, content_type = _normalize(_decode(data_url))
    blob_path = _blob_path(car.id, content_type)

    photo_storage.save(blob_path, content, content_type, container=CONTAINER_NAME)

    # A PNG replaced by a JPEG (or vice versa) lands at a different fixed
    # path — clean up the old one so it doesn't linger unused.
    if car.photo_blob_path is not None and car.photo_blob_path != blob_path:
        photo_storage.delete(car.photo_blob_path, container=CONTAINER_NAME)

    car.photo_blob_path = blob_path
    car.photo_content_type = content_type
    car.photo_updated_at = datetime.now(timezone.utc)

    # Only the fact and size are audited; never the image itself.
    audit_log(
        db,
        user=actor,
        action="car.photo_changed",
        entity_type="car",
        entity_id=car.id,
        metadata={"change": "set", "bytes": len(content), "type": content_type},
    )

    db.commit()
    db.refresh(car)

    return car


def remove_car_photo(db: Session, *, car_id, actor: User) -> bool:
    car = _get_car(db, car_id)

    if car.photo_blob_path is None:
        return False

    photo_storage.delete(car.photo_blob_path, container=CONTAINER_NAME)

    car.photo_blob_path = None
    car.photo_content_type = None
    car.photo_updated_at = None

    audit_log(
        db,
        user=actor,
        action="car.photo_changed",
        entity_type="car",
        entity_id=car.id,
        metadata={"change": "removed"},
    )

    db.commit()

    return True
