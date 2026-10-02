from decimal import Decimal

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import Extra

from tests.test_reservations import (
    confirm_reservation,
    create_reservation,
    ensure_car_available,
    get_car_by_plate,
    get_location_id,
)


client = TestClient(app)


SEEDED_CODES = [
    "ADDITIONAL_DRIVER",
    "REFUELING_SERVICE",
    "PASSENGER_INSURANCE",
    "INTERIOR_COVERAGE",
    "BABY_SEAT",
    "CHILD_SEAT",
]


def get_extra(code: str) -> dict:
    extras = client.get("/api/extras").json()

    return next(extra for extra in extras if extra["code"] == code)


def quote(car_id: str, location_id: str, pickup_at: str, return_at: str, extras=None):
    return client.post(
        "/api/reservations/quote",
        json={
            "car_id": car_id,
            "pickup_location_id": location_id,
            "return_location_id": location_id,
            "pickup_at": pickup_at,
            "return_at": return_at,
            "extras": extras or [],
        },
    )


# --- Catalog -------------------------------------------------------------


def test_list_extras_returns_seeded_catalog_in_display_order():
    response = client.get("/api/extras")

    assert response.status_code == 200

    extras = response.json()
    codes = [extra["code"] for extra in extras]

    assert codes == SEEDED_CODES

    sort_orders = [extra["sort_order"] for extra in extras]
    assert sort_orders == sorted(sort_orders)


def test_extra_carries_pricing_metadata_the_wizard_needs():
    baby_seat = get_extra("BABY_SEAT")

    assert baby_seat["price_unit"] == "PER_DAY"
    assert baby_seat["max_quantity"] == 2
    assert baby_seat["name"]
    assert baby_seat["description"]


# --- Quoting -------------------------------------------------------------


def test_quote_prices_base_surcharge_and_extras():
    car = ensure_car_available("SA-008-AA")
    location_id = car["current_location"]["id"]
    driver = get_extra("ADDITIONAL_DRIVER")

    response = quote(
        car["id"],
        location_id,
        "2027-04-01T10:00:00Z",
        "2027-04-03T10:00:00Z",  # 2 days
        [{"extra_id": driver["id"], "quantity": 1}],
    )

    assert response.status_code == 200

    body = response.json()
    price_per_day = Decimal(car["price_per_day"])

    assert body["rental_days"] == 2
    assert body["base_amount"] == float(price_per_day * 2)
    assert body["short_term_fee"] == 30.0
    assert body["airport_change_fee"] == 0.0
    assert body["extras_amount"] == 14.0  # 7.00 x 2 days
    assert body["total_amount"] == float(price_per_day * 2) + 30.0 + 14.0
    assert body["car_available"] is True
    assert body["availability_message"] is None


def test_quote_per_rental_extra_ignores_duration():
    car = ensure_car_available("SA-008-AA")
    location_id = car["current_location"]["id"]
    refueling = get_extra("REFUELING_SERVICE")

    body = quote(
        car["id"],
        location_id,
        "2027-04-10T10:00:00Z",
        "2027-04-20T10:00:00Z",  # 10 days
        [{"extra_id": refueling["id"], "quantity": 1}],
    ).json()

    assert body["extras_amount"] == 45.0
    assert body["extras"][0]["price_unit"] == "PER_RENTAL"


def test_quote_rejects_return_before_pickup():
    car = get_car_by_plate("SA-008-AA")

    response = quote(
        car["id"],
        car["current_location"]["id"],
        "2027-04-05T10:00:00Z",
        "2027-04-01T10:00:00Z",
    )

    assert response.status_code == 400
    assert "after pickup" in response.json()["detail"]


def test_quote_rejects_unknown_extra():
    car = get_car_by_plate("SA-008-AA")

    response = quote(
        car["id"],
        car["current_location"]["id"],
        "2027-04-01T10:00:00Z",
        "2027-04-03T10:00:00Z",
        [{"extra_id": "00000000-0000-4000-8000-000000000000", "quantity": 1}],
    )

    assert response.status_code == 400
    assert "Unknown extra" in response.json()["detail"]


def test_quote_rejects_quantity_above_max_for_that_extra():
    car = get_car_by_plate("SA-008-AA")
    baby_seat = get_extra("BABY_SEAT")  # max_quantity 2

    response = quote(
        car["id"],
        car["current_location"]["id"],
        "2027-04-01T10:00:00Z",
        "2027-04-03T10:00:00Z",
        [{"extra_id": baby_seat["id"], "quantity": 3}],
    )

    assert response.status_code == 400
    assert "At most 2" in response.json()["detail"]


def test_quote_rejects_the_same_extra_twice():
    car = get_car_by_plate("SA-008-AA")
    driver = get_extra("ADDITIONAL_DRIVER")

    response = quote(
        car["id"],
        car["current_location"]["id"],
        "2027-04-01T10:00:00Z",
        "2027-04-03T10:00:00Z",
        [
            {"extra_id": driver["id"], "quantity": 1},
            {"extra_id": driver["id"], "quantity": 1},
        ],
    )

    assert response.status_code == 400
    assert "more than once" in response.json()["detail"]


def test_quote_rejects_zero_quantity_before_reaching_the_database():
    car = get_car_by_plate("SA-008-AA")
    driver = get_extra("ADDITIONAL_DRIVER")

    response = quote(
        car["id"],
        car["current_location"]["id"],
        "2027-04-01T10:00:00Z",
        "2027-04-03T10:00:00Z",
        [{"extra_id": driver["id"], "quantity": 0}],
    )

    assert response.status_code == 422


def test_quote_reports_unavailability_without_withholding_the_price():
    """
    A car booked out mid-form should still quote. The wizard shows the
    price alongside a precise warning rather than blanking the summary.
    """

    car = ensure_car_available("SA-009-AA")
    location_id = car["current_location"]["id"]

    reservation = create_reservation(
        car["id"],
        location_id,
        "2027-05-01T10:00:00Z",
        "2027-05-05T10:00:00Z",
    )
    confirm_reservation(reservation["id"])

    try:
        body = quote(
            car["id"],
            location_id,
            "2027-05-02T10:00:00Z",
            "2027-05-04T10:00:00Z",  # overlaps the reservation above
        ).json()

        assert body["car_available"] is False
        assert "already reserved" in body["availability_message"]
        assert body["total_amount"] > 0
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- Booking with extras -------------------------------------------------


def test_create_reservation_stores_extras_with_snapshotted_prices():
    car = ensure_car_available("SA-008-AA")
    location_id = car["current_location"]["id"]

    driver = get_extra("ADDITIONAL_DRIVER")
    child_seat = get_extra("CHILD_SEAT")

    reservation = create_reservation(
        car["id"],
        location_id,
        "2027-06-01T10:00:00Z",
        "2027-06-04T10:00:00Z",
        extras=[
            {"extra_id": driver["id"], "quantity": 1},
            {"extra_id": child_seat["id"], "quantity": 2},
        ],
    )

    try:
        by_code = {line["extra_code"]: line for line in reservation["extras"]}

        assert set(by_code) == {"ADDITIONAL_DRIVER", "CHILD_SEAT"}
        assert by_code["CHILD_SEAT"]["quantity"] == 2
        assert Decimal(by_code["ADDITIONAL_DRIVER"]["unit_price"]) == Decimal("7.00")
        assert by_code["ADDITIONAL_DRIVER"]["price_unit"] == "PER_DAY"

        # The detail endpoint returns a different schema; it must carry
        # the add-ons too, since the detail page renders them.
        fetched = client.get(f"/api/reservations/{reservation['id']}").json()
        assert len(fetched["extras"]) == 2
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_catalog_price_change_does_not_reprice_an_existing_booking():
    """
    The core of the snapshot design: an existing booking keeps the price
    it was booked at, while a new quote reflects the new catalog price.
    """

    car = ensure_car_available("SA-008-AA")
    location_id = car["current_location"]["id"]
    child_seat = get_extra("CHILD_SEAT")

    reservation = create_reservation(
        car["id"],
        location_id,
        "2027-07-01T10:00:00Z",
        "2027-07-03T10:00:00Z",
        extras=[{"extra_id": child_seat["id"], "quantity": 1}],
    )

    original_price = Decimal(reservation["extras"][0]["unit_price"])

    # Test-only backdoor, in the spirit of force_reservation_status: there
    # is deliberately no API for editing the catalog yet, and this is the
    # only way to exercise a price change.
    db = SessionLocal()

    try:
        catalog_row = db.get(Extra, child_seat["id"])
        catalog_row.price = original_price + Decimal("10.00")
        db.commit()

        fetched = client.get(f"/api/reservations/{reservation['id']}").json()
        assert Decimal(fetched["extras"][0]["unit_price"]) == original_price

        fresh = quote(
            car["id"],
            location_id,
            "2027-08-01T10:00:00Z",
            "2027-08-03T10:00:00Z",
            [{"extra_id": child_seat["id"], "quantity": 1}],
        ).json()

        assert fresh["extras"][0]["unit_price"] == float(original_price + Decimal("10.00"))
    finally:
        catalog_row = db.get(Extra, child_seat["id"])
        catalog_row.price = original_price
        db.commit()
        db.close()

        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_patch_replaces_the_extras_set_and_keeps_retained_snapshots():
    car = ensure_car_available("SA-008-AA")
    location_id = car["current_location"]["id"]

    driver = get_extra("ADDITIONAL_DRIVER")
    refueling = get_extra("REFUELING_SERVICE")
    baby_seat = get_extra("BABY_SEAT")

    reservation = create_reservation(
        car["id"],
        location_id,
        "2027-09-01T10:00:00Z",
        "2027-09-04T10:00:00Z",
        extras=[
            {"extra_id": driver["id"], "quantity": 1},
            {"extra_id": refueling["id"], "quantity": 1},
        ],
    )

    try:
        response = client.patch(
            f"/api/reservations/{reservation['id']}",
            json={
                "extras": [
                    {"extra_id": driver["id"], "quantity": 2},   # retained
                    {"extra_id": baby_seat["id"], "quantity": 1},  # added
                ]
            },
        )

        assert response.status_code == 200

        by_code = {line["extra_code"]: line for line in response.json()["extras"]}

        assert set(by_code) == {"ADDITIONAL_DRIVER", "BABY_SEAT"}  # refueling dropped
        assert by_code["ADDITIONAL_DRIVER"]["quantity"] == 2
        assert Decimal(by_code["BABY_SEAT"]["unit_price"]) == Decimal("6.00")
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_patch_rejects_an_unknown_extra():
    car = ensure_car_available("SA-008-AA")
    location_id = car["current_location"]["id"]

    reservation = create_reservation(
        car["id"],
        location_id,
        "2027-10-01T10:00:00Z",
        "2027-10-04T10:00:00Z",
    )

    try:
        response = client.patch(
            f"/api/reservations/{reservation['id']}",
            json={
                "extras": [
                    {
                        "extra_id": "00000000-0000-4000-8000-000000000000",
                        "quantity": 1,
                    }
                ]
            },
        )

        assert response.status_code == 400
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")
