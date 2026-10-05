"""
A vehicle class's photo: the same caps and validate-and-reencode as a car's
(app/services/car_photos.py), kept in its own blob container.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import User, VehicleClass
from app.services import photo_storage
from app.services.audit import audit_log
from app.services.car_photos import _decode, _normalize
from app.services.vehicle_classes import get_class

CONTAINER_NAME = "class-photos"


def _blob_path(class_id, content_type: str) -> str:
    return f"{class_id}.{'png' if content_type == 'image/png' else 'jpg'}"


def read_class_photo(row: VehicleClass) -> bytes:
    return photo_storage.read(row.photo_blob_path, container=CONTAINER_NAME)


def set_class_photo(db: Session, *, class_id, actor: User, data_url: str) -> VehicleClass:
    row = get_class(db, class_id)

    content, content_type = _normalize(_decode(data_url))
    blob_path = _blob_path(row.id, content_type)

    photo_storage.save(blob_path, content, content_type, container=CONTAINER_NAME)

    # A PNG replaced by a JPEG (or the reverse) lands at another path: clean up the old one.
    if row.photo_blob_path is not None and row.photo_blob_path != blob_path:
        photo_storage.delete(row.photo_blob_path, container=CONTAINER_NAME)

    row.photo_blob_path = blob_path
    row.photo_content_type = content_type
    row.photo_updated_at = datetime.now(timezone.utc)

    audit_log(
        db,
        user=actor,
        action="vehicle_class.photo_changed",
        entity_type="vehicle_class",
        entity_id=row.id,
        metadata={"change": "set", "bytes": len(content), "type": content_type},
    )

    db.commit()
    db.refresh(row)

    return row


def delete_class_photo_file(row: VehicleClass) -> None:
    """Removes the stored file only; the caller clears the columns or deletes the row."""

    if row.photo_blob_path is not None:
        photo_storage.delete(row.photo_blob_path, container=CONTAINER_NAME)


def remove_class_photo(db: Session, *, class_id, actor: User) -> VehicleClass:
    row = get_class(db, class_id)

    if row.photo_blob_path is None:
        return row

    delete_class_photo_file(row)
    row.photo_blob_path = None
    row.photo_content_type = None
    row.photo_updated_at = None

    audit_log(
        db,
        user=actor,
        action="vehicle_class.photo_changed",
        entity_type="vehicle_class",
        entity_id=row.id,
        metadata={"change": "removed"},
    )

    db.commit()
    db.refresh(row)

    return row
