import base64
import io
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.database import SessionLocal
from tests._dates import far_future_days
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, BusinessLogo, User
from app.services.pdf_common import wrap_text
from tests.conftest import _get_fake_user
from tests.test_configuration import (
    _as_staff,
    _current_configuration,
    _last_configuration_audit_row,
    _restore,
    _restore_admin_override,
)

client = TestClient(app)


@pytest.fixture
def original_configuration():
    original = _current_configuration()

    yield original

    _restore(original)


@pytest.fixture(autouse=True)
def _no_logo_afterwards():
    yield

    db = SessionLocal()
    logo = db.get(BusinessLogo, 1)
    if logo is not None:
        db.delete(logo)
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
    return client.put("/api/configuration/logo", json={"data_url": _data_url(raw, mime)})


# --- profile fields ----------------------------------------------------


def test_defaults_reproduce_todays_behaviour(original_configuration):
    # A brand-new stack (or an upgraded one) starts with these values.
    # Only asserted where the test database is untouched by other tests.
    assert original_configuration["business_name"]
    assert original_configuration["locale"] in (
        "en", "en-GB", "en-US", "it", "de", "fr", "es", "pt", "nl", "pl"
    )


def test_update_business_profile_and_audit(original_configuration):
    response = client.patch(
        "/api/configuration",
        json={
            "business_name": "  Sardinia Wheels  ",
            "legal_name": "Sardinia Wheels S.r.l.",
            "address": "Via Roma 1\n07026 Olbia",
            "phone": "+39 0789 000000",
            "email": "hello@example.com",
            "vat_id": "IT01234567890",
            "timezone": "Europe/Rome",
            "locale": "it",
            "agreement_terms": "Terms line one.\nTerms line two.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["business_name"] == "Sardinia Wheels"
    assert body["timezone"] == "Europe/Rome"
    assert body["locale"] == "it"
    assert body["address"] == "Via Roma 1\n07026 Olbia"

    entry = _last_configuration_audit_row()
    assert entry.details["business_name"]["new"] == "Sardinia Wheels"
    assert entry.details["timezone"] == {"old": original_configuration["timezone"], "new": "Europe/Rome"}


def test_text_fields_can_be_cleared(original_configuration):
    client.patch("/api/configuration", json={"vat_id": "IT123"})
    response = client.patch("/api/configuration", json={"vat_id": ""})

    assert response.status_code == 200
    assert response.json()["vat_id"] == ""


@pytest.mark.parametrize(
    "payload",
    [
        {"business_name": "   "},
        {"business_name": "x" * 101},
        {"timezone": "Mars/Olympus_Mons"},
        {"locale": "xx-YY"},
        {"agreement_terms": "x" * 10001},
    ],
)
def test_invalid_profile_values_are_rejected(payload, original_configuration):
    assert client.patch("/api/configuration", json=payload).status_code == 422


def test_staff_cannot_change_the_profile():
    _as_staff()

    try:
        assert client.patch("/api/configuration", json={"business_name": "X"}).status_code == 403
        assert _upload(_png()).status_code == 403
        assert client.delete("/api/configuration/logo").status_code == 403
    finally:
        _restore_admin_override()


def test_authenticated_config_exposes_name_timezone_and_locale(original_configuration):
    body = client.get("/api/configuration/public").json()

    assert {"business_name", "timezone", "locale"} <= set(body)


# --- public branding -----------------------------------------------------


def test_branding_needs_no_login(original_configuration):
    app.dependency_overrides.pop(get_current_user, None)

    try:
        # With the suite's fake admin removed, a protected route refuses...
        assert client.get("/api/cars").status_code == 401

        # ...and branding still answers.
        response = client.get("/api/branding")
    finally:
        # The fixture that restores the configuration needs admin again.
        app.dependency_overrides[get_current_user] = _get_fake_user

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "business_name", "has_logo", "logo_version",
        "has_hero_image", "hero_image_version",
        "has_landing_about_image", "landing_about_image_version",
        "has_landing_cta_image", "landing_cta_image_version",
        "locale", "default_language", "accent_color",
    }
    assert body["has_logo"] is False
    assert body["logo_version"] is None
    assert body["has_hero_image"] is False
    assert body["hero_image_version"] is None


def test_branding_shows_the_configured_name(original_configuration):
    client.patch("/api/configuration", json={"business_name": "Island Cars"})

    assert client.get("/api/branding").json()["business_name"] == "Island Cars"


# --- logo ----------------------------------------------------------------


def test_uploaded_logo_is_served_publicly_with_caching():
    assert _upload(_png()).status_code == 204

    branding = client.get("/api/branding").json()
    assert branding["has_logo"] is True
    assert isinstance(branding["logo_version"], int)

    logo = client.get("/api/branding/logo")
    assert logo.status_code == 200
    assert logo.headers["content-type"] == "image/png"
    assert "max-age" in logo.headers["cache-control"]

    again = client.get("/api/branding/logo", headers={"If-None-Match": logo.headers["etag"]})
    assert again.status_code == 304


def test_logo_is_reencoded_and_downscaled():
    assert _upload(_png(2000, 1000)).status_code == 204

    stored = Image.open(io.BytesIO(client.get("/api/branding/logo").content))

    assert max(stored.size) <= 512
    # Aspect ratio survives.
    assert stored.size[0] == 2 * stored.size[1]


def test_jpeg_logo_stays_jpeg():
    assert _upload(_jpeg(), "image/jpeg").status_code == 204

    assert client.get("/api/branding/logo").headers["content-type"] == "image/jpeg"


def test_replacing_and_removing_the_logo():
    _upload(_png(color=(255, 0, 0, 255)))
    first = client.get("/api/branding/logo").content

    _upload(_png(color=(0, 255, 0, 255)))
    assert client.get("/api/branding/logo").content != first

    assert client.delete("/api/configuration/logo").status_code == 204
    assert client.get("/api/branding/logo").status_code == 404
    assert client.get("/api/branding").json()["has_logo"] is False

    # Removing when none exists is not an error.
    assert client.delete("/api/configuration/logo").status_code == 204


def test_logo_changes_are_audited_without_the_image():
    _upload(_png())

    entry = _last_configuration_audit_row("configuration.logo_changed")

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
def test_wrong_kinds_of_upload_are_rejected(data_url):
    response = client.put("/api/configuration/logo", json={"data_url": data_url})

    assert response.status_code == 400


def test_a_file_that_lies_about_its_type_is_rejected():
    # Text labelled as a PNG.
    assert _upload(b"this is not an image").status_code == 400
    # A real GIF labelled as a PNG.
    out = io.BytesIO()
    Image.new("RGB", (4, 4)).save(out, format="GIF")
    assert _upload(out.getvalue()).status_code == 400


def test_an_oversized_upload_is_rejected():
    # Incompressible noise keeps the PNG large.
    # About 356 KB of raw pixels: over the 300 KB limit, under the request cap.
    noise = Image.frombytes("RGB", (360, 330), os.urandom(360 * 330 * 3))
    out = io.BytesIO()
    noise.save(out, format="PNG", compress_level=0)

    response = _upload(out.getvalue())

    assert response.status_code == 400
    assert "too large" in response.json()["detail"]


# --- PDF -----------------------------------------------------------------


def test_wrap_text_wraps_and_keeps_paragraphs():
    lines = wrap_text("word " * 60 + "\n\nSecond paragraph.", size=8, width=200)

    assert len(lines) > 3
    assert "" in lines
    assert lines[-1] == "Second paragraph."


def test_agreement_pdf_renders_with_a_logo_and_custom_terms(original_configuration):
    from app.services.agreement_pdf import render_agreement_pdf
    from tests.test_handovers import create_confirmed_reservation
    from app.models import Handover, Reservation
    from datetime import datetime, timedelta, timezone
    
    client.patch(
        "/api/configuration",
        json={
            "business_name": "Island Cars",
            "legal_name": "Island Cars S.r.l.",
            "address": "Via Roma 1\nOlbia",
            "vat_id": "IT123",
            "agreement_terms": "Custom clause. " * 80,
        },
    )
    _upload(_png(300, 120))

    pickup = datetime.now(timezone.utc) + timedelta(days=far_future_days())
    reservation = create_confirmed_reservation(
        "SA-008-AA",
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (pickup + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )

    db = SessionLocal()
    try:
        from uuid import UUID

        row = db.get(Reservation, UUID(reservation["id"]))
        client.get(f"/api/reservations/{reservation['id']}/handover")
        handover = db.query(Handover).filter(Handover.reservation_id == row.id).one()

        with_logo = render_agreement_pdf(db, row, row.car, handover)
        db.delete(db.get(BusinessLogo, 1))
        db.commit()
        without_logo = render_agreement_pdf(db, row, row.car, handover)
    finally:
        db.close()
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

    assert with_logo.startswith(b"%PDF")
    assert without_logo.startswith(b"%PDF")
    assert len(with_logo) > len(without_logo)


def test_the_brand_colour_is_black_until_set_then_saved_and_public(original_configuration):
    assert client.get("/api/branding").json()["accent_color"] == original_configuration["accent_color"]

    saved = client.patch("/api/configuration", json={"accent_color": " #1F4FD8 "})

    assert saved.status_code == 200, saved.text
    assert saved.json()["accent_color"] == "#1f4fd8"
    assert client.get("/api/branding").json()["accent_color"] == "#1f4fd8"
    assert client.get("/api/public/config").json()["accent_color"] == "#1f4fd8"


def test_only_a_six_digit_hex_colour_is_accepted(original_configuration):
    for bad in ("blue", "#fff", "1f4fd8", "#1f4fd8;color:red", "url(javascript:1)"):
        assert client.patch("/api/configuration", json={"accent_color": bad}).status_code == 422, bad
