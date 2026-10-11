"""
A business can turn vehicle classes off (Configuration, Classes). The classes and the
cars' links to them are kept, but nothing is grouped any more: the storefront offers
each car on its own, a booking names its car, and a car can be priced on its own.
Turning it on again brings everything back.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.test_public_booking import (  # noqa: F401  (fixtures)
    _finish,
    _payload,
    _reservation,
    _window,
    fake_stripe,
    fresh_limits,
    storefront,
)
from tests.test_public_catalog import _search
from tests.test_public_classes import _class_offer, _offers, fleet  # noqa: F401  (fixtures)
from tests.test_reservations import get_location_id

client = TestClient(app)


def _set_classes(on: bool):
    response = client.patch("/api/configuration", json={"use_vehicle_classes": on})

    assert response.status_code == 200, response.text
    assert response.json()["use_vehicle_classes"] is on


@pytest.fixture
def classes_off():
    """Classes switched off for one test, and always back on afterwards."""

    _set_classes(False)

    yield

    _set_classes(True)


def _staff_booking(**ids):
    base_start, base_end = _window()

    return {
        "customer": {
            "first_name": "Off",
            "last_name": "Tester",
            "date_of_birth": "1990-01-01",
            "address": "Test Street 1",
            "postal_code": "1000AA",
            "phone_number": "+31600000000",
            "email": f"off.{uuid.uuid4().hex[:6]}@example.com",
        },
        "pickup_location_id": get_location_id("CAG"),
        "return_location_id": get_location_id("CAG"),
        "pickup_at": base_start.isoformat(),
        "return_at": base_end.isoformat(),
        **ids,
    }


def test_classes_are_on_by_default_and_the_setting_reaches_every_staff_screen():
    assert client.get("/api/configuration").json()["use_vehicle_classes"] is True
    assert client.get("/api/configuration/public").json()["use_vehicle_classes"] is True


def test_turning_classes_off_reaches_the_configuration_every_staff_screen_reads(classes_off):
    assert client.get("/api/configuration/public").json()["use_vehicle_classes"] is False


def test_with_classes_off_the_storefront_offers_each_car_on_its_own(storefront, fleet):
    make_class, make_car = fleet
    cls = make_class("48.00")
    make_car(cls["id"], "Fiat", "Panda", seats=4)
    make_car(cls["id"], "Ford", "Fiesta", seats=5)

    on_offers, _ = _offers()

    assert _class_offer(on_offers, cls) is not None

    _set_classes(False)

    try:
        offers, _ = _offers()
        fleet_page = client.get("/api/public/fleet").json()
    finally:
        _set_classes(True)

    assert _class_offer(offers, cls) is None
    assert not any(item["class_slug"] == cls["slug"] for item in offers + fleet_page)

    mine = [o for o in offers if (o["make"], o["model"]) in {("Fiat", "Panda"), ("Ford", "Fiesta")} and o["class_slug"] is None]

    # The page does not say "or similar" for a car shown on its own; with classes on it still does.
    assert all(o["or_similar"] is False for o in mine)
    assert all(o["or_similar"] is True for o in on_offers)

    # Two different cars are two offers, each at the price the car carries, with no class words.
    assert {(o["make"], o["model"]) for o in mine} >= {("Fiat", "Panda"), ("Ford", "Fiesta")}
    assert all(o["price_per_day"] == 48.0 and o["class_name"] is None and len(o["offer_key"]) == 24 for o in mine)
    assert not any(k in str(mine) for k in ("PC-", cls["slug"]))


def test_the_class_comes_back_when_classes_are_turned_on_again(storefront, fleet):
    make_class, make_car = fleet
    cls = make_class()
    make_car(cls["id"])

    _set_classes(False)
    _set_classes(True)

    assert _class_offer(_offers()[0], cls) is not None


def test_with_classes_off_a_class_that_is_not_offered_online_no_longer_hides_its_cars(storefront, fleet):
    make_class, make_car = fleet
    hidden = make_class(offered_online=False)
    make_car(hidden["id"], "Hidden", "Wagon")

    assert not any(o["make"] == "Hidden" for o in _offers()[0])

    _set_classes(False)

    try:
        # The car's own "offered online" switch decides now.
        assert any(o["make"] == "Hidden" and o["model"] == "Wagon" for o in _offers()[0])
    finally:
        _set_classes(True)


def test_booking_with_classes_off_holds_that_car_and_it_is_not_swappable(storefront, fleet, fake_stripe, classes_off):
    make_class, make_car = fleet
    cls = make_class("48.00")
    make_car(cls["id"], "Solo", "Offclass")
    make_car(cls["id"], "Solo", "Offclass2")

    offers, (pickup, dropoff) = _offers()
    offer = next(o for o in offers if o["model"] == "Offclass")
    location_id = get_location_id("CAG")

    created = client.post(
        "/api/public/bookings",
        json=_payload(offer, location_id, pickup, dropoff, email=f"off-{uuid.uuid4().hex[:6]}@example.com"),
        headers={"X-Forwarded-For": f"198.19.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250 + 1}"},
    )

    assert created.status_code == 201, created.text

    reference = created.json()["reference"]

    try:
        view = client.get(
            f"/api/public/bookings/{reference}", headers={"Authorization": f"Bearer {created.json()['manage_token']}"}
        ).json()

        # The renter sees the car they chose, not "a car of a class".
        assert view["vehicle"]["class_slug"] is None
        assert view["vehicle"]["model"] == "Offclass"

        # The car was chosen by the renter, so staff are not free to swap it.
        assert _reservation(reference).car_confirmed is True
    finally:
        _finish(reference)


def test_a_staff_booking_must_name_its_car_while_classes_are_off(fleet, classes_off):
    make_class, make_car = fleet
    cls = make_class()
    car = make_car(cls["id"], "Staff", "Named")

    refused = client.post("/api/reservations", json=_staff_booking(class_id=cls["id"]))

    assert refused.status_code == 400 and refused.json()["code"] == "reservation.classes_off"

    quoted = client.post("/api/reservations/quote", json=_staff_booking(class_id=cls["id"]))

    assert quoted.status_code == 400 and quoted.json()["code"] == "reservation.classes_off"

    named = client.post("/api/reservations", json=_staff_booking(car_id=car["id"]))

    assert named.status_code == 201, named.text
    assert named.json()["car_confirmed"] is True


def test_a_staff_booking_for_a_class_still_works_while_classes_are_on(fleet):
    make_class, make_car = fleet
    cls = make_class()
    make_car(cls["id"], "Staff", "Classy")

    response = client.post("/api/reservations", json=_staff_booking(class_id=cls["id"]))

    assert response.status_code == 201, response.text
    assert response.json()["car_confirmed"] is False


def test_with_classes_off_a_car_in_a_class_can_be_priced_on_its_own_and_leaves_the_class(fleet):
    make_class, make_car = fleet
    cls = make_class("42.00")
    car = make_car(cls["id"], "Priced", "Alone")

    refused = client.patch(f"/api/admin/cars/{car['id']}/price", json={"price_per_day": "10"})

    assert refused.status_code == 400 and refused.json()["code"] == "car.price_set_by_class"

    _set_classes(False)

    try:
        priced = client.patch(f"/api/admin/cars/{car['id']}/price", json={"price_per_day": "10"})
    finally:
        _set_classes(True)

    assert priced.status_code == 200, priced.text
    assert priced.json()["price_per_day"] == "10.00"
    assert priced.json()["class_id"] is None

    # A later change to the class price no longer reaches it.
    client.patch(f"/api/admin/vehicle-classes/{cls['id']}", json={"price_per_day": "60"})

    again = next(c for c in client.get("/api/cars").json() if c["id"] == car["id"])

    assert again["price_per_day"] == "10.00"
