"""
The public read API: switched off until the admin turns it on, renter-safe
responses (no plates, no internal fields), offers instead of cars, and prices
that match the staff quote.
"""

import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import Car
from app.services import rate_limit
from app.services.public_catalog import MIN_ONLINE_CHARGE, split_payment
from tests.test_reservations import confirm_reservation, create_reservation, ensure_car_available, get_location_id

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_limits():
    rate_limit.reset()
    yield
    rate_limit.reset()


@pytest.fixture
def storefront():
    """The storefront switched on, and back off afterwards."""

    assert client.patch("/api/configuration", json={"storefront_enabled": True}).status_code == 200

    try:
        yield
    finally:
        client.patch("/api/configuration", json={"storefront_enabled": False})


def _window(days_ahead=None, length=3):
    # Public bookings are limited to a year ahead, so these cannot use the far
    # future the staff tests use; a random spot keeps runs from meeting.
    start = days_ahead if days_ahead is not None else random.randint(30, 330)
    pickup = (datetime.now(timezone.utc) + timedelta(days=start)).replace(hour=10, minute=0, second=0, microsecond=0)

    return pickup, pickup + timedelta(days=length)


def _iso(value):
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def _search(location_id, pickup, dropoff, **extra):
    return client.get(
        "/api/public/availability",
        params={"pickup_location_id": location_id, "pickup_at": _iso(pickup), "return_at": _iso(dropoff), **extra},
    )


# --- off until switched on ---------------------------------------------------------------------


def test_everything_but_the_config_is_hidden_while_the_storefront_is_off():
    assert client.get("/api/public/config").json()["storefront_enabled"] is False

    for path in ("/api/public/legal", "/api/public/locations", "/api/public/extras", "/api/public/fleet"):
        response = client.get(path)

        assert response.status_code == 404, path
        assert response.json()["code"] == "public.storefront_disabled"

    pickup, dropoff = _window()

    assert _search(get_location_id("CAG"), pickup, dropoff).status_code == 404


# --- what is exposed -----------------------------------------------------------------------------


def test_config_exposes_only_what_a_renter_needs():
    body = client.get("/api/public/config").json()

    assert set(body) == {
        "storefront_enabled", "business_name", "has_logo", "logo_version", "locale", "default_language",
        "languages", "currency", "prices_include_vat", "vat_rate", "online_share_percent",
        "free_cancellation_hours", "hold_minutes", "min_booking_lead_hours", "legal_version", "terms_url",
        "privacy_url", "has_terms_text", "has_privacy_text",
        "landing_headline", "landing_tagline",
        "landing_benefit1_title", "landing_benefit1_body",
        "landing_benefit2_title", "landing_benefit2_body",
        "landing_benefit3_title", "landing_benefit3_body",
        "has_hero_image", "hero_image_version",
    }
    assert body["languages"] == ["en", "it", "pl"]


def test_locations_extras_and_fleet_have_no_internal_fields(storefront):
    locations = client.get("/api/public/locations").json()
    extras = client.get("/api/public/extras").json()
    fleet = client.get("/api/public/fleet").json()

    assert locations and extras and fleet

    assert all(set(item) == {"id", "name", "airport_code", "address", "timezone"} for item in locations)
    assert all(
        set(item) == {"id", "code", "name", "description", "translations", "price", "price_unit", "max_quantity"}
        for item in extras
    )
    assert all(
        set(item)
        == {"make", "model", "year", "category", "transmission", "fuel_type", "seats", "image_url", "price_per_day"}
        for item in fleet
    )


def test_legal_texts_are_served(storefront):
    body = client.get("/api/public/legal").json()

    assert set(body) == {"legal_version", "terms_text", "terms_url", "privacy_text", "privacy_url"}


# --- offers -------------------------------------------------------------------------------------------


def test_availability_lists_offers_without_plates_or_car_ids(storefront):
    car = ensure_car_available("SA-005-AA")
    pickup, dropoff = _window()

    response = _search(get_location_id("CAG"), pickup, dropoff)

    assert response.status_code == 200

    body = response.json()

    assert body["rental_days"] == 3
    assert body["offers"]

    for offer in body["offers"]:
        assert set(offer) == {
            "offer_key", "make", "model", "year", "category", "transmission", "fuel_type", "seats",
            "image_url", "price_per_day", "currency", "total_amount", "online_amount", "due_at_pickup",
        }
        assert round(offer["online_amount"] + offer["due_at_pickup"], 2) == offer["total_amount"]

    text = response.text

    assert car["license_plate"] not in text
    assert car["id"] not in text


def test_identical_cars_are_one_offer_and_keys_are_opaque(storefront):
    pickup, dropoff = _window()

    offers = _search(get_location_id("CAG"), pickup, dropoff).json()["offers"]
    keys = [offer["offer_key"] for offer in offers]

    assert len(keys) == len(set(keys))
    assert all(len(key) == 24 and "-" not in key for key in keys)


def _plates_offered(location_id, pickup, dropoff):
    from app.services.public_catalog import bookable_cars

    db = SessionLocal()
    try:
        return {c.license_plate for c in bookable_cars(db, UUID(location_id), pickup, dropoff)}
    finally:
        db.close()


def test_a_car_the_admin_does_not_offer_online_is_left_out(storefront):
    car = ensure_car_available("SA-005-AA")
    pickup, dropoff = _window()
    location_id = get_location_id("CAG")

    def set_offered(value):
        db = SessionLocal()
        try:
            db.get(Car, UUID(car["id"])).offered_online = value
            db.commit()
        finally:
            db.close()

    try:
        set_offered(True)
        assert "SA-005-AA" in _plates_offered(location_id, pickup, dropoff)

        set_offered(False)
        assert "SA-005-AA" not in _plates_offered(location_id, pickup, dropoff)
    finally:
        set_offered(True)


def test_a_booked_car_is_not_offered_for_the_same_dates(storefront):
    car = ensure_car_available("SA-005-AA")
    location_id = get_location_id("CAG")
    pickup, dropoff = _window()

    assert "SA-005-AA" in _plates_offered(location_id, pickup, dropoff)

    booking = create_reservation(car["id"], location_id, _iso(pickup), _iso(dropoff))
    confirm_reservation(booking["id"])

    try:
        assert "SA-005-AA" not in _plates_offered(location_id, pickup, dropoff)
    finally:
        client.patch(f"/api/reservations/{booking['id']}/cancel")


def test_a_car_returned_at_another_airport_is_offered_there_afterwards(storefront):
    """A one-way rental leaves the car at the return location, so later
    bookings find it there and no longer at its old airport."""

    car = ensure_car_available("SA-005-AA")
    cag, olb = get_location_id("CAG"), get_location_id("OLB")
    first_pickup, first_return = _window(length=2)

    payload = {
        "customer": {
            "first_name": "Test", "last_name": "User", "date_of_birth": "1995-01-01",
            "address": "Test Street 1", "postal_code": "1000AA", "phone_number": "+31600000000",
            "email": "test.user@example.com",
        },
        "car_id": car["id"], "pickup_location_id": cag, "return_location_id": olb,
        "pickup_at": _iso(first_pickup), "return_at": _iso(first_return),
    }
    booking = client.post("/api/reservations", json=payload)

    assert booking.status_code == 201
    confirm_reservation(booking.json()["id"])

    try:
        later_pickup = first_return + timedelta(days=1)
        later_return = later_pickup + timedelta(days=2)

        from app.services.availability import get_available_cars

        db = SessionLocal()
        try:
            at_olb = {c.license_plate for c in get_available_cars(db, UUID(olb), later_pickup, later_return)}
            at_cag = {c.license_plate for c in get_available_cars(db, UUID(cag), later_pickup, later_return)}
        finally:
            db.close()

        assert "SA-005-AA" in at_olb
        assert "SA-005-AA" not in at_cag
    finally:
        client.patch(f"/api/reservations/{booking.json()['id']}/cancel")


# --- the period ----------------------------------------------------------------------------------------


def test_the_period_is_checked(storefront):
    location_id = get_location_id("CAG")
    now = datetime.now(timezone.utc)

    too_soon = _search(location_id, now + timedelta(hours=2), now + timedelta(days=3))
    assert too_soon.status_code == 400
    assert too_soon.json()["code"] == "public.pickup_too_soon"

    pickup, _ = _window()

    backwards = _search(location_id, pickup, pickup - timedelta(days=1))
    assert backwards.json()["code"] == "reservation.return_before_pickup"

    too_long = _search(location_id, pickup, pickup + timedelta(days=90))
    assert too_long.json()["code"] == "public.rental_too_long"

    too_far = _search(location_id, now + timedelta(days=500), now + timedelta(days=503))
    assert too_far.json()["code"] == "public.pickup_too_far_ahead"

    naive = client.get(
        "/api/public/availability",
        params={
            "pickup_location_id": location_id,
            "pickup_at": "2030-01-01T10:00:00",
            "return_at": "2030-01-03T10:00:00",
        },
    )
    assert naive.json()["code"] == "public.datetime_needs_zone"


# --- quoting ----------------------------------------------------------------------------------------------


def _first_offer(location_id, pickup, dropoff):
    return _search(location_id, pickup, dropoff).json()["offers"][0]


def test_quote_matches_the_offer_and_splits_the_payment(storefront):
    location_id = get_location_id("CAG")
    ensure_car_available("SA-005-AA")
    pickup, dropoff = _window()
    offer = _first_offer(location_id, pickup, dropoff)

    response = client.post(
        "/api/public/quote",
        json={
            "offer_key": offer["offer_key"],
            "pickup_location_id": location_id,
            "return_location_id": location_id,
            "pickup_at": _iso(pickup),
            "return_at": _iso(dropoff),
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["total_amount"] == offer["total_amount"]
    assert body["online_amount"] == offer["online_amount"]
    assert body["due_at_pickup"] == offer["due_at_pickup"]
    assert body["online_share_percent"] == 30
    assert body["free_cancellation_hours"] == 48
    assert datetime.fromisoformat(body["cancellation_deadline_at"].replace("Z", "+00:00")) == pickup - timedelta(hours=48)


def test_quote_with_an_extra_costs_more(storefront):
    location_id = get_location_id("CAG")
    ensure_car_available("SA-005-AA")
    pickup, dropoff = _window()
    offer = _first_offer(location_id, pickup, dropoff)
    extra = client.get("/api/public/extras").json()[0]

    response = client.post(
        "/api/public/quote",
        json={
            "offer_key": offer["offer_key"],
            "pickup_location_id": location_id,
            "return_location_id": location_id,
            "pickup_at": _iso(pickup),
            "return_at": _iso(dropoff),
            "extras": [{"extra_id": extra["id"], "quantity": 1}],
        },
    )

    assert response.status_code == 200
    assert response.json()["total_amount"] > offer["total_amount"]
    assert response.json()["extras"][0]["code"] == extra["code"]


def test_quote_for_an_unknown_offer_is_a_conflict(storefront):
    location_id = get_location_id("CAG")
    pickup, dropoff = _window()

    response = client.post(
        "/api/public/quote",
        json={
            "offer_key": "0" * 24,
            "pickup_location_id": location_id,
            "return_location_id": location_id,
            "pickup_at": _iso(pickup),
            "return_at": _iso(dropoff),
        },
    )

    assert response.status_code == 409
    assert response.json()["code"] == "public.offer_unavailable"


# --- the online share ---------------------------------------------------------------------------------------


def test_share_is_the_percentage_rounded_to_cents():
    assert split_payment(Decimal("100.00"), 30) == (Decimal("30.00"), Decimal("70.00"))
    assert split_payment(Decimal("99.99"), 30) == (Decimal("30.00"), Decimal("69.99"))
    assert split_payment(Decimal("10.05"), 33) == (Decimal("3.32"), Decimal("6.73"))


def test_a_full_prepayment_leaves_nothing_at_pickup():
    assert split_payment(Decimal("240.00"), 100) == (Decimal("240.00"), Decimal("0.00"))


def test_the_share_is_never_below_the_smallest_charge_stripe_takes_nor_above_the_total():
    online, rest = split_payment(Decimal("10.00"), 1)

    assert online == MIN_ONLINE_CHARGE
    assert rest == Decimal("9.50")

    assert split_payment(Decimal("0.30"), 30) == (Decimal("0.30"), Decimal("0.00"))


# --- limits -------------------------------------------------------------------------------------------------------


def test_searches_are_rate_limited_per_address(storefront):
    location_id = get_location_id("CAG")
    pickup, dropoff = _window()
    statuses = [_search(location_id, pickup, dropoff).status_code for _ in range(32)]

    assert statuses[:30] == [200] * 30
    assert statuses[30:] == [429, 429]

    limited = _search(location_id, pickup, dropoff)

    assert limited.json()["code"] == "public.rate_limited"
    assert int(limited.headers["Retry-After"]) >= 1


def test_the_limit_counts_each_address_separately(storefront):
    location_id = get_location_id("CAG")
    pickup, dropoff = _window()

    def search_from(address):
        return client.get(
            "/api/public/availability",
            params={"pickup_location_id": location_id, "pickup_at": _iso(pickup), "return_at": _iso(dropoff)},
            headers={"X-Forwarded-For": address},
        ).status_code

    assert [search_from("198.51.100.1") for _ in range(30)] == [200] * 30
    assert search_from("198.51.100.1") == 429
    assert search_from("198.51.100.2") == 200
