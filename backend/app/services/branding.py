"""
The business logo: validating an upload, storing it, and reading it back.

The upload arrives as a data URL in JSON rather than multipart, which needs
no extra dependency and matches how signatures already travel in this app.
Everything about the file is re-derived from its bytes (Pillow decodes it,
and it is re-encoded from the pixels), never trusted from what the client
claimed, so a mislabelled or hostile file cannot end up served back as an
image.
"""

import base64
import binascii
import io
import re
from datetime import datetime, timezone

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.models import BusinessLogo, User
from app.services.audit import audit_log

LOGO_ID = 1

# A logo is a small graphic. The cap applies to the decoded upload; the
# stored copy is downscaled and re-encoded, so it is usually smaller still.
MAX_UPLOAD_BYTES = 300 * 1024
MAX_DIMENSION = 512
# Refuse absurd pixel counts before decoding (a tiny file can expand to
# gigabytes of pixels).
MAX_PIXELS = 25_000_000

_DATA_URL = re.compile(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$")


class InvalidLogo(ValueError):
    pass


def _decode(data_url: str) -> bytes:
    match = _DATA_URL.match(data_url.strip())

    if match is None:
        raise InvalidLogo("The logo must be a PNG or JPEG image.")

    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError):
        raise InvalidLogo("The logo file is corrupted.")

    if len(raw) > MAX_UPLOAD_BYTES:
        raise InvalidLogo(
            f"The logo is too large. The limit is {MAX_UPLOAD_BYTES // 1024} KB."
        )

    return raw


def _normalize(raw: bytes) -> tuple[bytes, str]:
    """Decodes, downscales and re-encodes. Returns (bytes, content type)."""

    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("PNG", "JPEG"):
                raise InvalidLogo("The logo must be a PNG or JPEG image.")

            width, height = image.size

            if width * height > MAX_PIXELS:
                raise InvalidLogo("The logo dimensions are too large.")

            image.load()
            image_format = image.format
            working = image.copy()
    except InvalidLogo:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise InvalidLogo("The logo file could not be read as an image.")

    working.thumbnail((MAX_DIMENSION, MAX_DIMENSION))

    out = io.BytesIO()

    if image_format == "JPEG":
        working.convert("RGB").save(out, format="JPEG", quality=88, optimize=True)
        return out.getvalue(), "image/jpeg"

    working.save(out, format="PNG", optimize=True)

    return out.getvalue(), "image/png"


def get_logo(db: Session) -> BusinessLogo | None:
    return db.get(BusinessLogo, LOGO_ID)


def set_logo(db: Session, *, actor: User, data_url: str) -> BusinessLogo:
    content, content_type = _normalize(_decode(data_url))

    logo = get_logo(db)

    if logo is None:
        logo = BusinessLogo(id=LOGO_ID, content=content, content_type=content_type)
        db.add(logo)
    else:
        logo.content = content
        logo.content_type = content_type

    logo.updated_at = datetime.now(timezone.utc)

    # Only the fact and size are audited; never the image itself.
    audit_log(
        db,
        user=actor,
        action="configuration.logo_changed",
        entity_type="configuration",
        entity_id=None,
        metadata={"change": "set", "bytes": len(content), "type": content_type},
    )

    db.commit()
    db.refresh(logo)

    return logo


def remove_logo(db: Session, *, actor: User) -> bool:
    logo = get_logo(db)

    if logo is None:
        return False

    db.delete(logo)

    audit_log(
        db,
        user=actor,
        action="configuration.logo_changed",
        entity_type="configuration",
        entity_id=None,
        metadata={"change": "removed"},
    )

    db.commit()

    return True
