"""
Vehicle classes: groups of cars rented out alike at one price. The class price is
written to its cars; a classed car cannot be priced on its own.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog
from tests.test_reservations import get_location_id

client = TestClient(app)


def _name() -> str:
    return f"Class {uuid.uuid4().hex[:8]}"


def _make_class(price="40.00", **extra):
    response = client.post(
        "/api/admin/vehicle-classes",
        json={"name": {"en": _name(), "it": "Classe"}, "price_per_day": price, **extra},
    )

    assert response.status_code == 201, response.text

    return response.json()


def _make_car(**extra):
    response = client.post(
        "/api/admin/cars",
        json={
            "make": "Fiat",
            "model": "Panda",
            "year": 2023,
            "license_plate": f"CL-{uuid.uuid4().hex[:6].upper()}",
            "home_location_id": get_location_id("CAG"),
            **extra,
        },
    )

    assert response.status_code == 201, response.text

    return response.json()


@pytest.fixture
def made():
    """Cars and classes a test created; the cars leave the fleet and the classes are retired afterwards."""

    cars: list[str] = []
    classes: list[str] = []

    yield cars, classes

    for car_id in cars:
        client.put(f"/api/admin/cars/{car_id}/class", json={"class_id": None})
        client.post(f"/api/admin/cars/{car_id}/retire")

    for class_id in classes:
        client.post(f"/api/admin/vehicle-classes/{class_id}/retire")


def _track(made, car=None, cls=None):
    if car:
        made[0].append(car["id"])

    if cls:
        made[1].append(cls["id"])

    return car or cls


def _price_of(car_id: str) -> str:
    return client.get(f"/api/cars/{car_id}").json()["price_per_day"]


def test_a_class_is_created_with_a_slug_per_language_text_and_no_cars(made):
    cls = _track(made, cls=_make_class(description={"en": "Small and easy", "pl": "Mały"}))

    assert cls["slug"].startswith("class-")
    assert cls["name"]["it"] == "Classe" and cls["description"]["pl"] == "Mały"
    assert cls["car_count"] == 0 and cls["is_retired"] is False
    assert cls["id"] in [row["id"] for row in client.get("/api/vehicle-classes").json()]


def test_a_class_needs_an_english_name_and_known_languages(made):
    no_english = client.post("/api/admin/vehicle-classes", json={"name": {"it": "Solo italiano"}, "price_per_day": "10"})
    unknown = client.post("/api/admin/vehicle-classes", json={"name": {"en": "A", "xx": "B"}, "price_per_day": "10"})
    too_long = client.post("/api/admin/vehicle-classes", json={"name": {"en": "A" * 81}, "price_per_day": "10"})

    assert no_english.status_code == 400 and no_english.json()["code"] == "class.name_required"
    assert unknown.json()["code"] == "class.unknown_language"
    assert too_long.json()["code"] == "class.text_too_long"
    assert client.post("/api/admin/vehicle-classes", json={"name": {"en": "A"}, "price_per_day": "-1"}).status_code == 422


def test_two_classes_with_the_same_name_get_different_slugs(made):
    name = _name()
    a = _track(made, cls=client.post("/api/admin/vehicle-classes", json={"name": {"en": name}, "price_per_day": "10"}).json())
    b = _track(made, cls=client.post("/api/admin/vehicle-classes", json={"name": {"en": name}, "price_per_day": "10"}).json())

    assert a["slug"] != b["slug"]


def test_a_car_joining_a_class_takes_its_price_and_a_price_change_reaches_every_car(made):
    cls = _track(made, cls=_make_class("40.00"))
    first = _track(made, car=_make_car(price_per_day="99.00"))
    second = _track(made, car=_make_car(class_id=cls["id"]))

    assert second["price_per_day"] == "40.00"
    assert second["vehicle_class"]["id"] == cls["id"]

    joined = client.put(f"/api/admin/cars/{first['id']}/class", json={"class_id": cls["id"]})

    assert joined.status_code == 200 and joined.json()["price_per_day"] == "40.00"

    changed = client.patch(f"/api/admin/vehicle-classes/{cls['id']}", json={"price_per_day": "55.50"})

    assert changed.status_code == 200 and changed.json()["car_count"] == 2
    assert _price_of(first["id"]) == "55.50" and _price_of(second["id"]) == "55.50"


def test_a_classed_car_cannot_be_priced_on_its_own_but_can_leave_with_its_price(made):
    cls = _track(made, cls=_make_class("42.00"))
    car = _track(made, car=_make_car(class_id=cls["id"]))

    refused = client.patch(f"/api/admin/cars/{car['id']}/price", json={"price_per_day": "10"})

    assert refused.status_code == 400 and refused.json()["code"] == "car.price_set_by_class"

    left = client.put(f"/api/admin/cars/{car['id']}/class", json={"class_id": None})

    assert left.json()["class_id"] is None and left.json()["price_per_day"] == "42.00"
    assert client.patch(f"/api/admin/cars/{car['id']}/price", json={"price_per_day": "10"}).status_code == 200

    # And a later class price change no longer touches it.
    client.patch(f"/api/admin/vehicle-classes/{cls['id']}", json={"price_per_day": "60"})

    assert _price_of(car["id"]) == "10.00"


def test_a_car_needs_a_price_or_a_class():
    response = client.post(
        "/api/admin/cars",
        json={"make": "A", "model": "B", "year": 2020, "license_plate": f"NP-{uuid.uuid4().hex[:5]}", "home_location_id": get_location_id("CAG")},
    )

    assert response.status_code == 400 and response.json()["code"] == "car.price_required"


def test_a_class_with_cars_cannot_be_retired_and_a_retired_one_cannot_be_joined(made):
    cls = _make_class()
    car = _track(made, car=_make_car(class_id=cls["id"]))
    made[1].append(cls["id"])

    refused = client.post(f"/api/admin/vehicle-classes/{cls['id']}/retire")

    assert refused.status_code == 400 and refused.json()["code"] == "class.has_cars"

    client.put(f"/api/admin/cars/{car['id']}/class", json={"class_id": None})

    assert client.post(f"/api/admin/vehicle-classes/{cls['id']}/retire").json()["is_retired"] is True
    assert client.post(f"/api/admin/vehicle-classes/{cls['id']}/retire").json()["code"] == "class.already_retired"
    assert client.put(f"/api/admin/cars/{car['id']}/class", json={"class_id": cls["id"]}).json()["code"] == "class.retired"
    assert cls["id"] not in [row["id"] for row in client.get("/api/vehicle-classes").json()]
    assert cls["id"] in [row["id"] for row in client.get("/api/vehicle-classes?include_retired=true").json()]

    assert client.post(f"/api/admin/vehicle-classes/{cls['id']}/reactivate").json()["is_retired"] is False


def test_unknown_class_and_car_are_not_found(made):
    nobody = str(uuid.uuid4())

    assert client.patch(f"/api/admin/vehicle-classes/{nobody}", json={"sort_order": 1}).status_code == 404
    assert client.put(f"/api/admin/cars/{nobody}/class", json={"class_id": None}).status_code == 404

    car = _track(made, car=_make_car(price_per_day="10"))

    assert client.put(f"/api/admin/cars/{car['id']}/class", json={"class_id": nobody}).json()["code"] == "class.not_found"


def test_changes_are_audited(made):
    cls = _track(made, cls=_make_class("20"))
    car = _track(made, car=_make_car(class_id=cls["id"]))
    client.patch(f"/api/admin/vehicle-classes/{cls['id']}", json={"price_per_day": "25", "name": {"en": _name()}})

    db = SessionLocal()
    try:
        actions = {
            row.action
            for row in db.scalars(
                select(AuditLog).where(AuditLog.entity_id.in_([uuid.UUID(cls["id"]), uuid.UUID(car["id"])]))
            )
        }
    finally:
        db.close()

    assert {"vehicle_class.created", "vehicle_class.updated"} <= actions
