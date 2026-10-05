"""
The storefront offers vehicle classes: one offer per class, the business's own words
and price, an example car "or similar", and a booking for a class picks a real car.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.test_public_booking import (  # noqa: F401  (fixtures)
    _finish,
    _payload,
    _window,
    fake_stripe,
    fresh_limits,
    storefront,
)
from tests.test_public_catalog import _search
from tests.test_reservations import get_location_id

client = TestClient(app)


@pytest.fixture
def fleet():
    """Makes classes and cars for a test, and takes them out of the fleet afterwards."""

    cars: list[str] = []
    classes: list[str] = []

    def make_class(price="48.00", **extra):
        response = client.post(
            "/api/admin/vehicle-classes",
            json={
                "name": {"en": f"Cls {uuid.uuid4().hex[:6]}", "it": "Classe prova"},
                "description": {"en": "Easy to park"},
                "price_per_day": price,
                **extra,
            },
        )
        assert response.status_code == 201, response.text
        classes.append(response.json()["id"])

        return response.json()

    def make_car(class_id=None, make="Fiat", model="Panda", seats=4, transmission="MANUAL", photo=False):
        response = client.post(
            "/api/admin/cars",
            json={
                "make": make,
                "model": model,
                "year": 2023,
                "license_plate": f"PC-{uuid.uuid4().hex[:6].upper()}",
                "home_location_id": get_location_id("CAG"),
                "class_id": class_id,
                "price_per_day": None if class_id else "30.00",
                "seats": seats,
                "transmission": transmission,
                "offered_online": True,
            },
        )
        assert response.status_code == 201, response.text
        cars.append(response.json()["id"])

        return response.json()

    yield make_class, make_car

    for car_id in cars:
        client.put(f"/api/admin/cars/{car_id}/class", json={"class_id": None})
        client.post(f"/api/admin/cars/{car_id}/retire")

    for class_id in classes:
        client.post(f"/api/admin/vehicle-classes/{class_id}/retire")


def _offers():
    pickup, dropoff = _window()
    response = _search(get_location_id("CAG"), pickup, dropoff)

    assert response.status_code == 200, response.text

    return response.json()["offers"], (pickup, dropoff)


def _class_offer(offers, cls):
    return next((offer for offer in offers if offer["offer_key"] == f"class-{cls['slug']}"), None)


def test_cars_of_a_class_are_one_offer_at_the_class_price_even_when_they_differ(storefront, fleet):
    make_class, make_car = fleet
    cls = make_class("48.00")
    make_car(cls["id"], "Fiat", "Panda", seats=4, transmission="MANUAL")
    make_car(cls["id"], "Ford", "Fiesta", seats=5, transmission="AUTOMATIC")

    offers, _ = _offers()
    offer = _class_offer(offers, cls)

    assert offer is not None
    assert len([o for o in offers if o["class_slug"] == cls["slug"]]) == 1
    assert offer["price_per_day"] == 48.0
    assert offer["class_name"]["it"] == "Classe prova" and offer["class_description"]["en"] == "Easy to park"
    assert (offer["seats_min"], offer["seats_max"]) == (4, 5)
    assert offer["transmissions"] == ["AUTOMATIC", "MANUAL"]
    # An example car, never a plate or id.
    assert offer["make"] in ("Fiat", "Ford")
    assert "PC-" not in str(offer)


def test_the_fleet_page_lists_the_class_once_in_the_businesss_order(storefront, fleet):
    make_class, make_car = fleet
    last = make_class("20.00", sort_order=9000)
    first = make_class("99.00", sort_order=1)
    make_car(last["id"])
    make_car(first["id"])
    make_car(first["id"], "Fiat", "500")

    keys = [item["offer_key"] for item in client.get("/api/public/fleet").json()]

    assert keys.count(f"class-{first['slug']}") == 1 and keys.count(f"class-{last['slug']}") == 1
    assert keys.index(f"class-{first['slug']}") < keys.index(f"class-{last['slug']}")


def test_a_retired_or_offline_class_is_not_offered(storefront, fleet):
    make_class, make_car = fleet
    offline = make_class(offered_online=False)
    make_car(offline["id"])
    online = make_class()
    make_car(online["id"])

    offers, _ = _offers()
    fleet_keys = [item["offer_key"] for item in client.get("/api/public/fleet").json()]

    assert _class_offer(offers, offline) is None and f"class-{offline['slug']}" not in fleet_keys
    assert _class_offer(offers, online) is not None

    client.patch(f"/api/admin/vehicle-classes/{online['id']}", json={"offered_online": False})

    assert _class_offer(_offers()[0], online) is None


def test_a_class_photo_is_the_example_cars_and_an_unknown_class_has_none(storefront, fleet):
    make_class, make_car = fleet
    cls = make_class()
    make_car(cls["id"])

    assert client.get(f"/api/public/offers/class-{cls['slug']}/photo").status_code == 404
    assert client.get("/api/public/offers/class-no-such-class/photo").status_code == 404


def test_booking_a_class_holds_one_of_its_cars_and_shows_the_class_to_the_renter(storefront, fleet, fake_stripe):
    make_class, make_car = fleet
    cls = make_class("48.00")
    make_car(cls["id"], "Fiat", "Panda")
    make_car(cls["id"], "Ford", "Fiesta")

    offers, (pickup, dropoff) = _offers()
    offer = _class_offer(offers, cls)
    location_id = get_location_id("CAG")

    created = client.post(
        "/api/public/bookings",
        json=_payload(offer, location_id, pickup, dropoff, email=f"class-{uuid.uuid4().hex[:6]}@example.com"),
        headers={"X-Forwarded-For": f"198.18.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250 + 1}"},
    )

    assert created.status_code == 201, created.text

    reference = created.json()["reference"]

    try:
        view = client.get(
            f"/api/public/bookings/{reference}", headers={"Authorization": f"Bearer {created.json()['manage_token']}"}
        ).json()

        assert view["vehicle"]["class_slug"] == cls["slug"]
        assert view["vehicle"]["offer_key"] == f"class-{cls['slug']}"
        assert view["vehicle"]["price_per_day"] == 48.0

        # One of the two cars is held; the class is still offered for the same dates, with one car left.
        again = _class_offer(_search(location_id, pickup, dropoff).json()["offers"], cls)

        assert again is not None
    finally:
        _finish(reference)


def test_cars_without_a_class_still_group_as_before(storefront, fleet):
    make_class, make_car = fleet
    make_car(None, "Solo", "Single")
    make_car(None, "Solo", "Single")

    offers, _ = _offers()
    solo = [o for o in offers if o["make"] == "Solo" and o["model"] == "Single"]

    assert len(solo) == 1
    assert solo[0]["class_slug"] is None and len(solo[0]["offer_key"]) == 24
