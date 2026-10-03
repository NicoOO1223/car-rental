"""
The storefront landing page's call-to-action banner photo: validating an upload,
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
from app.models import LandingCtaImage, User
from app.services import photo_storage
from app.services.audit import audit_log

CTA_ID = 1
CONTAINER_NAME = "landing-images"

MAX_UPLOAD_BYTES = 3 * 1024 * 1024
MAX_DIMENSION = 1920
MAX_PIXELS = 60_000_000

_DATA_URL = re.compile(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$")


class InvalidCtaImage(AppError):
    """A banner image that cannot be used. An AppError, so the interface shows the reason in the user's language."""


def _decode(data_url: str) -> bytes:
    match = _DATA_URL.match(data_url.strip())

    if match is None:
        raise InvalidCtaImage("landing_cta.wrong_type", "The image must be a PNG or JPEG image.")

    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError):
        raise InvalidCtaImage("landing_cta.corrupted", "The image file is corrupted.")

    if len(raw) > MAX_UPLOAD_BYTES:
        raise InvalidCtaImage(
            "landing_cta.too_large",
            f"The image is too large. The limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            limit_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
        )

    return raw


def _normalize(raw: bytes) -> tuple[bytes, str]:
    """Decodes, downscales and re-encodes. Returns (bytes, content type)."""

    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("PNG", "JPEG"):
                raise InvalidCtaImage("landing_cta.wrong_type", "The image must be a PNG or JPEG image.")

            width, height = image.size

            if width * height > MAX_PIXELS:
                raise InvalidCtaImage("landing_cta.dimensions_too_large", "The image dimensions are too large.")

            image.load()
            image_format = image.format
            working = image.copy()
    except InvalidCtaImage:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise InvalidCtaImage("landing_cta.unreadable", "The image file could not be read as an image.")

    working.thumbnail((MAX_DIMENSION, MAX_DIMENSION))

    out = io.BytesIO()

    if image_format == "JPEG":
        working.convert("RGB").save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue(), "image/jpeg"

    working.save(out, format="PNG", optimize=True)

    return out.getvalue(), "image/png"


def _blob_path(content_type: str) -> str:
    extension = "png" if content_type == "image/png" else "jpg"
    return f"banner.{extension}"


def get_cta_image(db: Session) -> LandingCtaImage | None:
    return db.get(LandingCtaImage, CTA_ID)


def read_cta_image(banner: LandingCtaImage) -> bytes:
    return photo_storage.read(banner.blob_path, container=CONTAINER_NAME)


def set_cta_image(db: Session, *, actor: User, data_url: str) -> LandingCtaImage:
    content, content_type = _normalize(_decode(data_url))
    blob_path = _blob_path(content_type)

    photo_storage.save(blob_path, content, content_type, container=CONTAINER_NAME)

    banner = get_cta_image(db)

    if banner is None:
        banner = LandingCtaImage(id=CTA_ID, blob_path=blob_path, content_type=content_type)
        db.add(banner)
    else:
        # A PNG replaced by a JPEG (or vice versa) lands at a different
        # fixed path — clean up the old one so it doesn't linger unused.
        if banner.blob_path != blob_path:
            photo_storage.delete(banner.blob_path, container=CONTAINER_NAME)

        banner.blob_path = blob_path
        banner.content_type = content_type

    banner.updated_at = datetime.now(timezone.utc)

    # Only the fact and size are audited; never the image itself.
    audit_log(
        db,
        user=actor,
        action="configuration.landing_cta_image_changed",
        entity_type="configuration",
        entity_id=None,
        metadata={"change": "set", "bytes": len(content), "type": content_type},
    )

    db.commit()
    db.refresh(banner)

    return banner


def remove_cta_image(db: Session, *, actor: User) -> bool:
    banner = get_cta_image(db)

    if banner is None:
        return False

    photo_storage.delete(banner.blob_path, container=CONTAINER_NAME)
    db.delete(banner)

    audit_log(
        db,
        user=actor,
        action="configuration.landing_cta_image_changed",
        entity_type="configuration",
        entity_id=None,
        metadata={"change": "removed"},
    )

    db.commit()

    return True
