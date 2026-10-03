"""
The storefront landing page's hero photo: validating an upload, storing
it, and reading it back.

A real photo, not a small graphic like the business logo (see
app/services/branding.py, whose validation this mirrors) — the caps are
correspondingly higher, matching app/services/condition_reviews.py's
photo handling. Unlike the logo, the bytes live in blob storage via
app/services/photo_storage.py (its own "landing-images" container), not
in the database — see app/models/landing_hero_image.py for why.
"""

import base64
import binascii
import io
import re
from datetime import datetime, timezone

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import LandingHeroImage, User
from app.services import photo_storage
from app.services.audit import audit_log

HERO_ID = 1
CONTAINER_NAME = "landing-images"

MAX_UPLOAD_BYTES = 3 * 1024 * 1024
MAX_DIMENSION = 1920
MAX_PIXELS = 60_000_000

_DATA_URL = re.compile(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$")


class InvalidHeroImage(AppError):
    """A hero image that cannot be used. An AppError, so the interface shows the reason in the user's language."""


def _decode(data_url: str) -> bytes:
    match = _DATA_URL.match(data_url.strip())

    if match is None:
        raise InvalidHeroImage("landing_hero.wrong_type", "The hero image must be a PNG or JPEG image.")

    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError):
        raise InvalidHeroImage("landing_hero.corrupted", "The hero image file is corrupted.")

    if len(raw) > MAX_UPLOAD_BYTES:
        raise InvalidHeroImage(
            "landing_hero.too_large",
            f"The hero image is too large. The limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            limit_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
        )

    return raw


def _normalize(raw: bytes) -> tuple[bytes, str]:
    """Decodes, downscales and re-encodes. Returns (bytes, content type)."""

    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("PNG", "JPEG"):
                raise InvalidHeroImage("landing_hero.wrong_type", "The hero image must be a PNG or JPEG image.")

            width, height = image.size

            if width * height > MAX_PIXELS:
                raise InvalidHeroImage("landing_hero.dimensions_too_large", "The hero image dimensions are too large.")

            image.load()
            image_format = image.format
            working = image.copy()
    except InvalidHeroImage:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise InvalidHeroImage("landing_hero.unreadable", "The hero image file could not be read as an image.")

    working.thumbnail((MAX_DIMENSION, MAX_DIMENSION))

    out = io.BytesIO()

    if image_format == "JPEG":
        working.convert("RGB").save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue(), "image/jpeg"

    working.save(out, format="PNG", optimize=True)

    return out.getvalue(), "image/png"


def _blob_path(content_type: str) -> str:
    extension = "png" if content_type == "image/png" else "jpg"
    return f"hero.{extension}"


def get_hero_image(db: Session) -> LandingHeroImage | None:
    return db.get(LandingHeroImage, HERO_ID)


def read_hero_image(hero: LandingHeroImage) -> bytes:
    return photo_storage.read(hero.blob_path, container=CONTAINER_NAME)


def set_hero_image(db: Session, *, actor: User, data_url: str) -> LandingHeroImage:
    content, content_type = _normalize(_decode(data_url))
    blob_path = _blob_path(content_type)

    photo_storage.save(blob_path, content, content_type, container=CONTAINER_NAME)

    hero = get_hero_image(db)

    if hero is None:
        hero = LandingHeroImage(id=HERO_ID, blob_path=blob_path, content_type=content_type)
        db.add(hero)
    else:
        hero.blob_path = blob_path
        hero.content_type = content_type

    hero.updated_at = datetime.now(timezone.utc)

    # Only the fact and size are audited; never the image itself.
    audit_log(
        db,
        user=actor,
        action="configuration.landing_hero_changed",
        entity_type="configuration",
        entity_id=None,
        metadata={"change": "set", "bytes": len(content), "type": content_type},
    )

    db.commit()
    db.refresh(hero)

    return hero


def remove_hero_image(db: Session, *, actor: User) -> bool:
    hero = get_hero_image(db)

    if hero is None:
        return False

    db.delete(hero)

    audit_log(
        db,
        user=actor,
        action="configuration.landing_hero_changed",
        entity_type="configuration",
        entity_id=None,
        metadata={"change": "removed"},
    )

    db.commit()

    return True
