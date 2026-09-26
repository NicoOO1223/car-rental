from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.pricing import ExtraSelection, calculate_price_breakdown
from tests.test_reservations import ensure_car_available

client = TestClient(app)

PICKUP = datetime(2030, 6, 1, 10, 0, tzinfo=timezone.utc)
RETURN = datetime(2030, 6, 3, 10, 0, tzinfo=timezone.utc)  # two days


def _breakdown(price_per_day, *, rate, include, extras=()):
    location = uuid4()

    return calculate_price_breakdown(
        Decimal(price_per_day),
        PICKUP,
        RETURN,
        location,
        location,
        short_term_threshold_days=0,  # no short-term fee
        short_term_fee=Decimal("0.00"),
        airport_change_fee=Decimal("0.00"),
        extras=extras,
        vat_rate=Decimal(rate),
        prices_include_vat=include,
    )


# --- the maths -------------------------------------------------------------


def test_no_vat_by_default_changes_nothing():
    breakdown = calculate_price_breakdown(
        Decimal("50.00"), PICKUP, RETURN, uuid4(), uuid4(),
        short_term_threshold_days=0,
        short_term_fee=Decimal("0.00"),
        airport_change_fee=Decimal("0.00"),
    )

    assert breakdown.vat_amount == Decimal("0.00")
    assert breakdown.total_amount == breakdown.lines_amount == Decimal("100.00")
    assert breakdown.net_amount == Decimal("100.00")


def test_zero_rate_shows_no_vat_in_either_mode():
    for include in (True, False):
        breakdown = _breakdown("50.00", rate="0", include=include)

        assert breakdown.vat_amount == Decimal("0.00")
        assert breakdown.total_amount == Decimal("100.00")


def test_prices_including_vat_extract_it_and_leave_the_total_alone():
    # Two days at 61.00 = 122.00, of which 22% VAT is 22.00.
    breakdown = _breakdown("61.00", rate="22", include=True)

    assert breakdown.total_amount == Decimal("122.00")
    assert breakdown.vat_amount == Decimal("22.00")
    assert breakdown.net_amount == Decimal("100.00")


def test_prices_excluding_vat_add_it_on_top():
    # Two days at 50.00 = 100.00 net; 22% VAT is 22.00; the customer pays 122.00.
    breakdown = _breakdown("50.00", rate="22", include=False)

    assert breakdown.lines_amount == Decimal("100.00")
    assert breakdown.vat_amount == Decimal("22.00")
    assert breakdown.total_amount == Decimal("122.00")
    assert breakdown.net_amount == Decimal("100.00")


def test_vat_is_rounded_half_up_to_the_cent():
    # Inclusive: 10.00 at 22% is 10 * 22 / 122 = 1.8032..., which is 1.80.
    inclusive = _breakdown("5.00", rate="22", include=True)
    assert inclusive.vat_amount == Decimal("1.80")
    assert inclusive.net_amount == Decimal("8.20")

    # Exclusive: 1.00 at 10% is exactly 0.10; 0.50 at 10% is 0.05.
    exclusive = _breakdown("0.25", rate="10", include=False)
    assert exclusive.vat_amount == Decimal("0.05")

    # A true half cent rounds up: 0.15 at 10% is 0.015, which is 0.02.
    half = _breakdown("0.075", rate="10", include=False)
    assert half.vat_amount == Decimal("0.02")


def test_vat_is_worked_out_once_on_the_total_not_line_by_line():
    # Two extras of 1.05 each at 20% inclusive. Line by line, each has
    # 0.175 of VAT, which rounds to 0.18 each and 0.36 together. On the
    # 2.10 total it is 0.35. The invoice must add up, so the total wins.
    extras = [
        ExtraSelection(code="A", name="A", quantity=1, unit_price=Decimal("1.05"), price_unit="PER_RENTAL"),
        ExtraSelection(code="B", name="B", quantity=1, unit_price=Decimal("1.05"), price_unit="PER_RENTAL"),
    ]

    breakdown = _breakdown("0.00", rate="20", include=True, extras=extras)

    assert breakdown.total_amount == Decimal("2.10")
    assert breakdown.vat_amount == Decimal("0.35")
    assert breakdown.net_amount + breakdown.vat_amount == breakdown.total_amount


@pytest.mark.parametrize("include", [True, False])
@pytest.mark.parametrize("rate", ["5", "7.5", "19", "22", "27"])
def test_net_plus_vat_always_equals_the_total(rate, include):
    breakdown = _breakdown("37.33", rate=rate, include=include)

    assert breakdown.net_amount + breakdown.vat_amount == breakdown.total_amount


# --- through the API ---------------------------------------------------------


@pytest.fixture
def vat_settings():
    original = client.get("/api/configuration").json()

    def set_to(rate, include):
        response = client.patch(
            "/api/configuration", json={"vat_rate": rate, "prices_include_vat": include}
        )
        assert response.status_code == 200

    yield set_to

    client.patch(
        "/api/configuration",
        json={
            "vat_rate": original["vat_rate"],
            "prices_include_vat": original["prices_include_vat"],
        },
    )


def _quote():
    car = ensure_car_available("SA-008-AA")

    response = client.post(
        "/api/reservations/quote",
        json={
            "car_id": car["id"],
            "pickup_location_id": car["current_location"]["id"],
            "return_location_id": car["current_location"]["id"],
            "pickup_at": "2028-08-01T10:00:00Z",
            "return_at": "2028-08-08T10:00:00Z",
        },
    )
    assert response.status_code == 200

    return response.json()


def test_quote_shows_vat_included(vat_settings):
    vat_settings(0, True)
    baseline = _quote()

    vat_settings(22, True)
    quote = _quote()

    assert quote["total_amount"] == baseline["total_amount"]
    assert quote["vat_rate"] == 22
    assert quote["prices_include_vat"] is True
    assert quote["vat_amount"] > 0
    assert round(quote["net_amount"] + quote["vat_amount"], 2) == quote["total_amount"]


def test_quote_adds_vat_on_top_when_prices_exclude_it(vat_settings):
    vat_settings(0, False)
    baseline = _quote()

    vat_settings(22, False)
    quote = _quote()

    assert quote["prices_include_vat"] is False
    assert quote["net_amount"] == baseline["total_amount"]
    assert quote["total_amount"] == round(baseline["total_amount"] + quote["vat_amount"], 2)
    assert quote["vat_amount"] == round(baseline["total_amount"] * 0.22, 2)


@pytest.mark.parametrize("payload", [{"vat_rate": -1}, {"vat_rate": 100.5}, {"invoice_prefix": ""}, {"invoice_prefix": "TOO-LONG-PREFIX"}, {"invoice_prefix": "A B"}])
def test_invalid_vat_settings_are_rejected(payload):
    assert client.patch("/api/configuration", json=payload).status_code == 422


def test_invoice_prefix_is_normalized():
    original = client.get("/api/configuration").json()["invoice_prefix"]

    try:
        response = client.patch("/api/configuration", json={"invoice_prefix": " fa-22 "})

        assert response.status_code == 200
        assert response.json()["invoice_prefix"] == "FA-22"
    finally:
        client.patch("/api/configuration", json={"invoice_prefix": original})
