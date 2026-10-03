"""
The storefront landing page's "About" photo: validating an upload,
storing it, and reading it back — identical to app/services/
landing_hero.py's own handling, just for a different fixed slot.
"""

import base64
import binascii
import io
import re
from datetime import datetime, timezone

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import LandingAboutImage, User
from app.services import photo_storage
from app.services.audit import audit_log

ABOUT_ID = 1
CONTAINER_NAME = "landing-images"

MAX_UPLOAD_BYTES = 3 * 1024 * 1024
MAX_DIMENSION = 1920
MAX_PIXELS = 60_000_000

_DATA_URL = re.compile(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$")


class InvalidAboutImage(AppError):
    """An About image that cannot be used. An AppError, so the interface shows the reason in the user's language."""


def _decode(data_url: str) -> bytes:
    match = _DATA_URL.match(data_url.strip())

    if match is None:
        raise InvalidAboutImage("landing_about.wrong_type", "The image must be a PNG or JPEG image.")

    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError):
        raise InvalidAboutImage("landing_about.corrupted", "The image file is corrupted.")

    if len(raw) > MAX_UPLOAD_BYTES:
        raise InvalidAboutImage(
            "landing_about.too_large",
            f"The image is too large. The limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            limit_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
        )

    return raw


def _normalize(raw: bytes) -> tuple[bytes, str]:
    """Decodes, downscales and re-encodes. Returns (bytes, content type)."""

    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("PNG", "JPEG"):
                raise InvalidAboutImage("landing_about.wrong_type", "The image must be a PNG or JPEG image.")

            width, height = image.size

            if width * height > MAX_PIXELS:
                raise InvalidAboutImage("landing_about.dimensions_too_large", "The image dimensions are too large.")

            image.load()
            image_format = image.format
            working = image.copy()
    except InvalidAboutImage:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise InvalidAboutImage("landing_about.unreadable", "The image file could not be read as an image.")

    working.thumbnail((MAX_DIMENSION, MAX_DIMENSION))

    out = io.BytesIO()

    if image_format == "JPEG":
        working.convert("RGB").save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue(), "image/jpeg"

    working.save(out, format="PNG", optimize=True)

    return out.getvalue(), "image/png"


def _blob_path(content_type: str) -> str:
    extension = "png" if content_type == "image/png" else "jpg"
    return f"about.{extension}"


def get_about_image(db: Session) -> LandingAboutImage | None:
    return db.get(LandingAboutImage, ABOUT_ID)


def read_about_image(about: LandingAboutImage) -> bytes:
    return photo_storage.read(about.blob_path, container=CONTAINER_NAME)


def set_about_image(db: Session, *, actor: User, data_url: str) -> LandingAboutImage:
    content, content_type = _normalize(_decode(data_url))
    blob_path = _blob_path(content_type)

    photo_storage.save(blob_path, content, content_type, container=CONTAINER_NAME)

    about = get_about_image(db)

    if about is None:
        about = LandingAboutImage(id=ABOUT_ID, blob_path=blob_path, content_type=content_type)
        db.add(about)
    else:
        # A PNG replaced by a JPEG (or vice versa) lands at a different
        # fixed path — clean up the old one so it doesn't linger unused.
        if about.blob_path != blob_path:
            photo_storage.delete(about.blob_path, container=CONTAINER_NAME)

        about.blob_path = blob_path
        about.content_type = content_type

    about.updated_at = datetime.now(timezone.utc)

    # Only the fact and size are audited; never the image itself.
    audit_log(
        db,
        user=actor,
        action="configuration.landing_about_image_changed",
        entity_type="configuration",
        entity_id=None,
        metadata={"change": "set", "bytes": len(content), "type": content_type},
    )

    db.commit()
    db.refresh(about)

    return about


def remove_about_image(db: Session, *, actor: User) -> bool:
    about = get_about_image(db)

    if about is None:
        return False

    photo_storage.delete(about.blob_path, container=CONTAINER_NAME)
    db.delete(about)

    audit_log(
        db,
        user=actor,
        action="configuration.landing_about_image_changed",
        entity_type="configuration",
        entity_id=None,
        metadata={"change": "removed"},
    )

    db.commit()

    return True
