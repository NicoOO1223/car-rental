"""
The storefront landing page: per-tenant headline/tagline/benefit text on
Configuration (see app/models/configuration.py), and the hero image, whose
bytes live in blob storage via app/services/landing_hero.py — the same
validate-and-reencode approach as the business logo (app/services/
branding.py), just with higher size/dimension caps since this is a real
photo, not a small graphic.
"""

import base64
import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.database import SessionLocal
from app.main import app
from app.models import LandingAboutImage, LandingHeroImage
from app.services import photo_storage
from tests.test_configuration import _current_configuration, _last_configuration_audit_row, _restore

client = TestClient(app)


@pytest.fixture
def original_configuration():
    original = _current_configuration()

    yield original

    _restore(original)


@pytest.fixture(autouse=True)
def _no_hero_image_afterwards():
    yield

    db = SessionLocal()
    hero = db.get(LandingHeroImage, 1)
    if hero is not None:
        db.delete(hero)
        db.commit()
    db.close()


@pytest.fixture(autouse=True)
def _no_about_image_afterwards():
    yield

    db = SessionLocal()
    about = db.get(LandingAboutImage, 1)
    if about is not None:
        db.delete(about)
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


def _upload(raw: bytes, mime="image/png"):
    return client.put("/api/configuration/landing-hero", json={"data_url": _data_url(raw, mime)})


def _upload_about(raw: bytes, mime="image/png"):
    return client.put("/api/configuration/landing-about-image", json={"data_url": _data_url(raw, mime)})


# --- text fields -----------------------------------------------------------


def test_landing_text_fields_can_be_set_and_read(original_configuration):
    response = client.patch(
        "/api/configuration",
        json={
            "landing_headline": "  Sardinia's friendliest car rental  ",
            "landing_tagline": "Fast pickup, fair prices, no surprises.",
            "landing_benefit1_title": "Newest fleet on the island",
            "landing_benefit1_body": "Every car under three years old.",
            "landing_benefit2_title": "Free airport pickup",
            "landing_benefit2_body": "No shuttle, no waiting.",
            "landing_benefit3_title": "24/7 roadside help",
            "landing_benefit3_body": "A real person answers, day or night.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["landing_headline"] == "Sardinia's friendliest car rental"
    assert body["landing_tagline"] == "Fast pickup, fair prices, no surprises."
    assert body["landing_benefit1_title"] == "Newest fleet on the island"
    assert body["landing_benefit2_body"] == "No shuttle, no waiting."
    assert body["landing_benefit3_title"] == "24/7 roadside help"

    assert _current_configuration()["landing_headline"] == "Sardinia's friendliest car rental"


def test_landing_text_fields_respect_their_length_limits(original_configuration):
    response = client.patch("/api/configuration", json={"landing_headline": "x" * 151})

    assert response.status_code == 422


def test_landing_about_text_fields_can_be_set_and_read(original_configuration):
    response = client.patch(
        "/api/configuration",
        json={
            "landing_about_title": "  About Sardinia Wheels  ",
            "landing_about_body": "We've been renting cars on the island since 2010.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["landing_about_title"] == "About Sardinia Wheels"
    assert body["landing_about_body"] == "We've been renting cars on the island since 2010."

    assert _current_configuration()["landing_about_title"] == "About Sardinia Wheels"


def test_landing_about_title_respects_its_length_limit(original_configuration):
    response = client.patch("/api/configuration", json={"landing_about_title": "x" * 101})

    assert response.status_code == 422


# --- hero image --------------------------------------------------------------


def test_uploaded_hero_image_is_served_publicly_with_caching():
    assert _upload(_png()).status_code == 204

    branding = client.get("/api/branding").json()
    assert branding["has_hero_image"] is True
    assert isinstance(branding["hero_image_version"], int)

    hero = client.get("/api/branding/landing-hero")
    assert hero.status_code == 200
    assert hero.headers["content-type"] == "image/png"
    assert "max-age" in hero.headers["cache-control"]

    again = client.get("/api/branding/landing-hero", headers={"If-None-Match": hero.headers["etag"]})
    assert again.status_code == 304


def test_no_hero_image_is_a_404():
    assert client.get("/api/branding/landing-hero").status_code == 404
    assert client.get("/api/branding").json()["has_hero_image"] is False


def test_hero_image_is_reencoded_and_downscaled():
    assert _upload(_png(2400, 1200)).status_code == 204

    stored = Image.open(io.BytesIO(client.get("/api/branding/landing-hero").content))

    assert max(stored.size) <= 1920
    # Aspect ratio survives.
    assert stored.size[0] == 2 * stored.size[1]


def test_hero_jpeg_stays_jpeg():
    assert _upload(_jpeg(), "image/jpeg").status_code == 204

    assert client.get("/api/branding/landing-hero").headers["content-type"] == "image/jpeg"


def test_replacing_and_removing_the_hero_image():
    _upload(_png(color=(255, 0, 0, 255)))
    first = client.get("/api/branding/landing-hero").content

    _upload(_png(color=(0, 255, 0, 255)))
    assert client.get("/api/branding/landing-hero").content != first

    assert client.delete("/api/configuration/landing-hero").status_code == 204
    assert client.get("/api/branding/landing-hero").status_code == 404
    assert client.get("/api/branding").json()["has_hero_image"] is False

    # Removing when none exists is not an error.
    assert client.delete("/api/configuration/landing-hero").status_code == 204


def _hero_blob_path() -> str:
    db = SessionLocal()
    try:
        return db.get(LandingHeroImage, 1).blob_path
    finally:
        db.close()


def test_replacing_a_png_hero_with_a_jpeg_removes_the_old_blob():
    _upload(_png())
    png_path = _hero_blob_path()
    assert png_path.endswith(".png")

    _upload(_jpeg(), "image/jpeg")

    with pytest.raises(FileNotFoundError):
        photo_storage.read(png_path, container="landing-images")


def test_removing_the_hero_image_deletes_its_blob():
    _upload(_png())
    blob_path = _hero_blob_path()

    assert client.delete("/api/configuration/landing-hero").status_code == 204

    with pytest.raises(FileNotFoundError):
        photo_storage.read(blob_path, container="landing-images")


def test_hero_image_changes_are_audited_without_the_image():
    _upload(_png())

    entry = _last_configuration_audit_row("configuration.landing_hero_changed")

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
def test_wrong_kinds_of_hero_upload_are_rejected(data_url):
    response = client.put("/api/configuration/landing-hero", json={"data_url": data_url})

    assert response.status_code == 400


def test_a_hero_file_that_lies_about_its_type_is_rejected():
    assert _upload(b"this is not an image").status_code == 400

    out = io.BytesIO()
    Image.new("RGB", (4, 4)).save(out, format="GIF")
    assert _upload(out.getvalue()).status_code == 400


def test_an_oversized_hero_upload_is_rejected():
    # Incompressible noise keeps the PNG large: ~3.3MB of raw pixels, over
    # the hero's 3MB limit (much higher than the logo's 300KB) but still
    # under the request body's own cap once base64-encoded.
    noise = Image.frombytes("RGB", (1050, 1050), os.urandom(1050 * 1050 * 3))
    out = io.BytesIO()
    noise.save(out, format="PNG", compress_level=0)

    response = _upload(out.getvalue())

    assert response.status_code == 400
    assert "too large" in response.json()["detail"]


# --- about image --------------------------------------------------------------


def test_uploaded_about_image_is_served_publicly_with_caching():
    assert _upload_about(_png()).status_code == 204

    branding = client.get("/api/branding").json()
    assert branding["has_landing_about_image"] is True
    assert isinstance(branding["landing_about_image_version"], int)

    about = client.get("/api/branding/landing-about-image")
    assert about.status_code == 200
    assert about.headers["content-type"] == "image/png"
    assert "max-age" in about.headers["cache-control"]

    again = client.get("/api/branding/landing-about-image", headers={"If-None-Match": about.headers["etag"]})
    assert again.status_code == 304


def test_no_about_image_is_a_404():
    assert client.get("/api/branding/landing-about-image").status_code == 404
    assert client.get("/api/branding").json()["has_landing_about_image"] is False


def test_about_image_is_reencoded_and_downscaled():
    assert _upload_about(_png(2400, 1200)).status_code == 204

    stored = Image.open(io.BytesIO(client.get("/api/branding/landing-about-image").content))

    assert max(stored.size) <= 1920
    assert stored.size[0] == 2 * stored.size[1]


def test_about_jpeg_stays_jpeg():
    assert _upload_about(_jpeg(), "image/jpeg").status_code == 204

    assert client.get("/api/branding/landing-about-image").headers["content-type"] == "image/jpeg"


def test_replacing_and_removing_the_about_image():
    _upload_about(_png(color=(255, 0, 0, 255)))
    first = client.get("/api/branding/landing-about-image").content

    _upload_about(_png(color=(0, 255, 0, 255)))
    assert client.get("/api/branding/landing-about-image").content != first

    assert client.delete("/api/configuration/landing-about-image").status_code == 204
    assert client.get("/api/branding/landing-about-image").status_code == 404
    assert client.get("/api/branding").json()["has_landing_about_image"] is False

    # Removing when none exists is not an error.
    assert client.delete("/api/configuration/landing-about-image").status_code == 204


def _about_blob_path() -> str:
    db = SessionLocal()
    try:
        return db.get(LandingAboutImage, 1).blob_path
    finally:
        db.close()


def test_replacing_a_png_about_image_with_a_jpeg_removes_the_old_blob():
    _upload_about(_png())
    png_path = _about_blob_path()
    assert png_path.endswith(".png")

    _upload_about(_jpeg(), "image/jpeg")

    with pytest.raises(FileNotFoundError):
        photo_storage.read(png_path, container="landing-images")


def test_removing_the_about_image_deletes_its_blob():
    _upload_about(_png())
    blob_path = _about_blob_path()

    assert client.delete("/api/configuration/landing-about-image").status_code == 204

    with pytest.raises(FileNotFoundError):
        photo_storage.read(blob_path, container="landing-images")


def test_about_image_changes_are_audited_without_the_image():
    _upload_about(_png())

    entry = _last_configuration_audit_row("configuration.landing_about_image_changed")

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
def test_wrong_kinds_of_about_upload_are_rejected(data_url):
    response = client.put("/api/configuration/landing-about-image", json={"data_url": data_url})

    assert response.status_code == 400


def test_an_about_file_that_lies_about_its_type_is_rejected():
    assert _upload_about(b"this is not an image").status_code == 400

    out = io.BytesIO()
    Image.new("RGB", (4, 4)).save(out, format="GIF")
    assert _upload_about(out.getvalue()).status_code == 400


def test_an_oversized_about_upload_is_rejected():
    noise = Image.frombytes("RGB", (1050, 1050), os.urandom(1050 * 1050 * 3))
    out = io.BytesIO()
    noise.save(out, format="PNG", compress_level=0)

    response = _upload_about(out.getvalue())

    assert response.status_code == 400
    assert "too large" in response.json()["detail"]


def test_hero_and_about_images_do_not_collide():
    """Each lives at its own fixed blob path, in the same container."""

    _upload(_png(color=(255, 0, 0, 255)))
    _upload_about(_png(color=(0, 0, 255, 255)))

    assert client.get("/api/branding/landing-hero").content != client.get("/api/branding/landing-about-image").content

    assert client.delete("/api/configuration/landing-hero").status_code == 204
    # Removing the hero must not touch the about image.
    assert client.get("/api/branding/landing-about-image").status_code == 200


# --- public exposure ----------------------------------------------------------


def test_public_config_exposes_landing_content_even_while_storefront_is_off(original_configuration):
    # Deliberately NOT using the `storefront` fixture: an operator should be
    # able to write their landing page before switching booking on.
    assert client.get("/api/configuration").json()["storefront_enabled"] is False

    client.patch(
        "/api/configuration",
        json={
            "landing_headline": "Rent with us",
            "landing_benefit1_title": "Great cars",
            "landing_about_title": "About us",
            "landing_about_body": "A family business since 2010.",
        },
    )
    _upload(_png())
    _upload_about(_png())

    body = client.get("/api/public/config").json()

    assert body["storefront_enabled"] is False
    assert body["landing_headline"] == "Rent with us"
    assert body["landing_benefit1_title"] == "Great cars"
    assert body["has_hero_image"] is True
    assert isinstance(body["hero_image_version"], int)
    assert body["landing_about_title"] == "About us"
    assert body["landing_about_body"] == "A family business since 2010."
    assert body["has_landing_about_image"] is True
    assert isinstance(body["landing_about_image_version"], int)


def test_public_config_landing_fields_are_empty_strings_by_default(original_configuration):
    client.patch(
        "/api/configuration",
        json={
            "landing_headline": "",
            "landing_tagline": "",
            "landing_benefit1_title": "",
            "landing_benefit1_body": "",
            "landing_benefit2_title": "",
            "landing_benefit2_body": "",
            "landing_benefit3_title": "",
            "landing_benefit3_body": "",
            "landing_about_title": "",
            "landing_about_body": "",
        },
    )

    body = client.get("/api/public/config").json()

    assert body["landing_headline"] == ""
    assert body["has_hero_image"] is False
    assert body["hero_image_version"] is None
    assert body["landing_about_title"] == ""
    assert body["has_landing_about_image"] is False
    assert body["landing_about_image_version"] is None


def test_social_links_are_saved_validated_and_public(original_configuration):
    saved = client.patch(
        "/api/configuration",
        json={"social_instagram_url": " https://instagram.com/rentals ", "social_whatsapp_url": "https://wa.me/390000000"},
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["social_instagram_url"] == "https://instagram.com/rentals"

    # Anything but a web address is refused, so an icon can never link to javascript:.
    for bad in ("javascript:alert(1)", "instagram.com/rentals"):
        assert client.patch("/api/configuration", json={"social_facebook_url": bad}).status_code == 422

    client.patch("/api/configuration", json={"storefront_enabled": True})
    public = client.get("/api/public/config").json()

    assert public["social_instagram_url"] == "https://instagram.com/rentals"
    assert public["social_facebook_url"] == ""
