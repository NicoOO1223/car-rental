"""
A car's photo: uploaded, not pasted as a URL — the same validate-and-
reencode approach as the storefront landing page's hero/about images
(see app/services/car_photos.py and tests/test_landing_page.py).
"""

import base64
import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.database import SessionLocal
from app.main import app
from app.models import Car
from app.services import photo_storage
from tests.test_reservations import ensure_car_available

client = TestClient(app)


@pytest.fixture
def car_id() -> str:
    car = ensure_car_available("SA-004-AA")

    yield car["id"]

    db = SessionLocal()
    stored = db.get(Car, car["id"])
    if stored is not None and stored.photo_blob_path is not None:
        photo_storage.delete(stored.photo_blob_path, container="car-photos")
        stored.photo_blob_path = None
        stored.photo_content_type = None
        stored.photo_updated_at = None
        db.commit()
    db.close()


def _png(width=64, height=32, color=(20, 120, 200, 255)) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (width, height), color).save(out, format="PNG")
    return out.getvalue()


def _jpeg(width=64, height=32) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (200, 30, 30)).save(out, format="JPEG")
    return out.getvalue()


def _data_url(raw: bytes, mime="image/png") -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def _upload(car_id: str, raw: bytes, mime="image/png"):
    return client.put(f"/api/cars/{car_id}/photo", json={"data_url": _data_url(raw, mime)})


def test_uploaded_photo_is_served_publicly_with_caching(car_id):
    assert _upload(car_id, _png()).status_code == 204

    car = client.get(f"/api/cars/{car_id}").json()
    assert car["has_photo"] is True
    assert isinstance(car["photo_version"], int)

    photo = client.get(f"/api/public/cars/{car_id}/photo")
    assert photo.status_code == 200
    assert photo.headers["content-type"] == "image/png"
    assert "max-age" in photo.headers["cache-control"]

    again = client.get(f"/api/public/cars/{car_id}/photo", headers={"If-None-Match": photo.headers["etag"]})
    assert again.status_code == 304


def test_no_photo_is_a_404():
    car = ensure_car_available("SA-004-AA")

    assert client.get(f"/api/public/cars/{car['id']}/photo").status_code == 404
    assert client.get(f"/api/cars/{car['id']}").json()["has_photo"] is False


def test_photo_for_unknown_car_is_a_404():
    assert client.get("/api/public/cars/00000000-0000-0000-0000-000000000000/photo").status_code == 404


def test_photo_is_reencoded_and_downscaled(car_id):
    assert _upload(car_id, _png(2400, 1200)).status_code == 204

    stored = Image.open(io.BytesIO(client.get(f"/api/public/cars/{car_id}/photo").content))

    assert max(stored.size) <= 1920
    assert stored.size[0] == 2 * stored.size[1]


def test_jpeg_stays_jpeg(car_id):
    assert _upload(car_id, _jpeg(), "image/jpeg").status_code == 204

    assert client.get(f"/api/public/cars/{car_id}/photo").headers["content-type"] == "image/jpeg"


def test_replacing_and_removing_the_photo(car_id):
    _upload(car_id, _png(color=(255, 0, 0, 255)))
    first = client.get(f"/api/public/cars/{car_id}/photo").content

    _upload(car_id, _png(color=(0, 255, 0, 255)))
    assert client.get(f"/api/public/cars/{car_id}/photo").content != first

    assert client.delete(f"/api/cars/{car_id}/photo").status_code == 204
    assert client.get(f"/api/public/cars/{car_id}/photo").status_code == 404
    assert client.get(f"/api/cars/{car_id}").json()["has_photo"] is False

    # Removing when none exists is not an error.
    assert client.delete(f"/api/cars/{car_id}/photo").status_code == 204


def _blob_path(car_id: str) -> str:
    db = SessionLocal()
    try:
        return db.get(Car, car_id).photo_blob_path
    finally:
        db.close()


def test_replacing_a_png_with_a_jpeg_removes_the_old_blob(car_id):
    _upload(car_id, _png())
    png_path = _blob_path(car_id)
    assert png_path.endswith(".png")

    _upload(car_id, _jpeg(), "image/jpeg")

    with pytest.raises(FileNotFoundError):
        photo_storage.read(png_path, container="car-photos")


def test_removing_the_photo_deletes_its_blob(car_id):
    _upload(car_id, _png())
    blob_path = _blob_path(car_id)

    assert client.delete(f"/api/cars/{car_id}/photo").status_code == 204

    with pytest.raises(FileNotFoundError):
        photo_storage.read(blob_path, container="car-photos")


def test_photo_changes_are_audited_without_the_image(car_id):
    _upload(car_id, _png())

    db = SessionLocal()
    try:
        from app.models import AuditLog

        entry = (
            db.query(AuditLog)
            .filter(AuditLog.entity_type == "car", AuditLog.action == "car.photo_changed")
            .order_by(AuditLog.created_at.desc())
            .first()
        )
    finally:
        db.close()

    assert entry.details["change"] == "set"
    assert entry.details["type"] == "image/png"
    assert "content" not in entry.details
    assert "data" not in str(entry.details).lower().replace("data_url", "")


@pytest.mark.parametrize(
    "data_url",
    [
        "not a data url",
        "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        "data:image/png;base64,!!!not-base64!!!",
    ],
)
def test_wrong_kinds_of_upload_are_rejected(car_id, data_url):
    response = client.put(f"/api/cars/{car_id}/photo", json={"data_url": data_url})

    assert response.status_code == 400


def test_a_file_that_lies_about_its_type_is_rejected(car_id):
    assert _upload(car_id, b"this is not an image").status_code == 400

    out = io.BytesIO()
    Image.new("RGB", (4, 4)).save(out, format="GIF")
    assert _upload(car_id, out.getvalue()).status_code == 400


def test_an_oversized_upload_is_rejected(car_id):
    noise = Image.frombytes("RGB", (1050, 1050), os.urandom(1050 * 1050 * 3))
    out = io.BytesIO()
    noise.save(out, format="PNG", compress_level=0)

    response = _upload(car_id, out.getvalue())

    assert response.status_code == 400
    assert "too large" in response.json()["detail"]


def _offer_key_for(car_id: str) -> str:
    from app.services.public_catalog import offer_key

    db = SessionLocal()
    try:
        return offer_key(db.get(Car, car_id))
    finally:
        db.close()


def test_offer_photo_resolves_via_offer_key(car_id):
    _upload(car_id, _png())

    key = _offer_key_for(car_id)

    response = client.get(f"/api/public/offers/{key}/photo")
    assert response.status_code == 200
    assert response.content == client.get(f"/api/public/cars/{car_id}/photo").content


def test_offer_photo_for_unknown_key_is_a_404():
    assert client.get("/api/public/offers/not-a-real-key/photo").status_code == 404


def test_uploading_for_an_unknown_car_is_a_404():
    response = client.put(
        "/api/cars/00000000-0000-0000-0000-000000000000/photo",
        json={"data_url": _data_url(_png())},
    )

    assert response.status_code == 404


# --- offer grouping --------------------------------------------------------
#
# group_into_offers() groups otherwise-identical cars so a renter never sees
# plates or internal ids — see app/services/public_catalog.py. Each photo
# upload gets its own timestamp, so the grouping key uses has_photo (does a
# photo exist) rather than which exact photo, or two cars that are otherwise
# identical would stop grouping together the moment either one got a photo.


def _unsaved_car(**overrides) -> Car:
    from decimal import Decimal

    defaults = dict(
        make="Fiat", model="Panda", year=2023, category="ECONOMY",
        transmission="MANUAL", fuel_type="PETROL", seats=5,
        price_per_day=Decimal("29.90"),
    )
    defaults.update(overrides)
    return Car(**defaults)


def test_two_identical_cars_group_together_even_with_different_photos():
    from datetime import datetime, timezone

    from app.services.public_catalog import group_into_offers

    a = _unsaved_car(photo_blob_path="a.png", photo_updated_at=datetime.now(timezone.utc))
    b = _unsaved_car(photo_blob_path="b.jpg", photo_updated_at=datetime.now(timezone.utc))

    groups = group_into_offers([a, b])

    assert len(groups) == 1
    assert len(groups[0][1]) == 2


def test_a_photographed_car_does_not_group_with_an_unphotographed_one():
    from datetime import datetime, timezone

    from app.services.public_catalog import group_into_offers

    a = _unsaved_car(photo_blob_path="a.png", photo_updated_at=datetime.now(timezone.utc))
    b = _unsaved_car()

    groups = group_into_offers([a, b])

    assert len(groups) == 2
