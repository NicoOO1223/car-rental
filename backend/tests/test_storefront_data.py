"""
The data the storefront rests on: the storefront settings in Configuration and
the price a booking was made at.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import Reservation
from tests._dates import far_future_days
from tests.test_reservations import create_reservation, ensure_car_available, get_location_id

client = TestClient(app)

STOREFRONT_FIELDS = {
    "storefront_enabled": False,
    "online_share_percent": 30,
    "free_cancellation_hours": 48,
    "hold_minutes": 15,
    "min_booking_lead_hours": 24,
}


def _configuration():
    return client.get("/api/configuration").json()


def _iso(value):
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_configuration_carries_the_storefront_fields():
    body = _configuration()

    for field in (*STOREFRONT_FIELDS, "terms_text", "terms_url", "privacy_text", "privacy_url", "legal_version"):
        assert field in body


def test_storefront_values_are_checked():
    cases = [
        ({"online_share_percent": -1}, "validation.online_share_range"),
        ({"online_share_percent": 101}, "validation.online_share_range"),
        ({"payment_window_hours": 0}, "validation.payment_window_range"),
        ({"payment_window_hours": 169}, "validation.payment_window_range"),
        ({"free_cancellation_hours": -1}, "validation.cancellation_hours_range"),
        ({"hold_minutes": 4}, "validation.hold_minutes_range"),
        ({"hold_minutes": 61}, "validation.hold_minutes_range"),
        ({"min_booking_lead_hours": -1}, "validation.lead_hours_range"),
        ({"terms_url": "not a link"}, "validation.url_invalid"),
    ]

    for payload, code in cases:
        response = client.patch("/api/configuration", json=payload)

        assert response.status_code in (400, 422), payload
        assert code in response.text, (payload, response.text)


def test_legal_version_goes_up_only_when_the_legal_text_changes():
    original = _configuration()

    try:
        same = client.patch("/api/configuration", json={"online_share_percent": 40})
        assert same.status_code == 200
        assert same.json()["legal_version"] == original["legal_version"]

        changed = client.patch("/api/configuration", json={"terms_text": "New terms " + str(original["legal_version"])})
        assert changed.status_code == 200
        assert changed.json()["legal_version"] == original["legal_version"] + 1
    finally:
        client.patch(
            "/api/configuration",
            json={"online_share_percent": original["online_share_percent"], "terms_text": original["terms_text"]},
        )


def test_a_new_booking_records_the_price_it_was_made_at_and_keeps_it():
    original = _configuration()
    car = ensure_car_available("SA-005-AA")
    pickup = datetime.now(timezone.utc) + timedelta(days=far_future_days())
    reservation = create_reservation(
        car["id"], get_location_id("CAG"), _iso(pickup), _iso(pickup + timedelta(days=2))
    )

    def stored():
        db = SessionLocal()
        try:
            row = db.get(Reservation, UUID(reservation["id"]))
            return row.agreed_total_amount, row.agreed_short_term_fee, row.agreed_price_per_day
        finally:
            db.close()

    try:
        total, fee, per_day = stored()

        assert total is not None and fee is not None and per_day is not None

        raised = client.patch("/api/configuration", json={"short_term_fee": float(original["short_term_fee"]) + 25})
        assert raised.status_code == 200

        assert stored() == (total, fee, per_day)
    finally:
        client.patch("/api/configuration", json={"short_term_fee": original["short_term_fee"]})
        client.patch(f"/api/reservations/{reservation['id']}/cancel")
