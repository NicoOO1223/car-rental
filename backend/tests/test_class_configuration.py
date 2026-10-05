"""
Configuring classes: a photo of their own, the order on the website, moving cars in
bulk, and removing a class (deleted when unused, retired when bookings were made for it).
"""

import base64
import io
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog, VehicleClass
from tests.test_public_booking import fresh_limits, storefront  # noqa: F401  (fixtures)
from tests.test_public_classes import _class_offer, _offers
from tests.test_reservations import get_location_id

client = TestClient(app)


def _png(color=(20, 120, 200, 255)) -> str:
    out = io.BytesIO()
    Image.new("RGBA", (64, 32), color).save(out, format="PNG")

    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def _make_class(price="30.00", **extra):
    response = client.post(
        "/api/admin/vehicle-classes",
        json={"name": {"en": f"Cfg {uuid.uuid4().hex[:8]}"}, "price_per_day": price, **extra},
    )

    assert response.status_code == 201, response.text

    return response.json()


def _make_car(class_id=None, price="55.00"):
    response = client.post(
        "/api/admin/cars",
        json={
            "make": "Fiat",
            "model": "Panda",
            "year": 2023,
            "license_plate": f"CF-{uuid.uuid4().hex[:6].upper()}",
            "home_location_id": get_location_id("CAG"),
            "class_id": class_id,
            "price_per_day": None if class_id else price,
            "offered_online": True,
        },
    )

    assert response.status_code == 201, response.text

    return response.json()


@pytest.fixture
def made():
    cars: list[str] = []
    classes: list[str] = []

    yield cars, classes

    for car_id in cars:
        client.put(f"/api/admin/cars/{car_id}/class", json={"class_id": None})
        client.post(f"/api/admin/cars/{car_id}/retire")

    for class_id in classes:
        client.post(f"/api/admin/vehicle-classes/{class_id}/remove", json={})


def _cls(made, **kwargs):
    row = _make_class(**kwargs)
    made[1].append(row["id"])

    return row


def _car(made, class_id=None, **kwargs):
    row = _make_car(class_id, **kwargs)
    made[0].append(row["id"])

    return row


def _listed(include_retired=False):
    url = "/api/vehicle-classes" + ("?include_retired=true" if include_retired else "")

    return {row["id"]: row for row in client.get(url).json()}


# --- photo ------------------------------------------------------------------------------------


def test_a_class_photo_is_uploaded_served_replaced_and_removed(storefront, made):
    cls = _cls(made)
    _car(made, cls["id"])

    assert cls["has_photo"] is False
    assert client.get(f"/api/public/offers/class-{cls['slug']}/photo").status_code == 404

    uploaded = client.put(f"/api/admin/vehicle-classes/{cls['id']}/photo", json={"data_url": _png()})

    assert uploaded.status_code == 200 and uploaded.json()["has_photo"] is True
    assert isinstance(uploaded.json()["photo_version"], int)

    served = client.get(f"/api/public/offers/class-{cls['slug']}/photo")

    assert served.status_code == 200 and served.headers["content-type"] == "image/png"
    assert served.headers["etag"] == f'"{uploaded.json()["photo_version"]}"'
    assert client.get(f"/api/public/offers/class-{cls['slug']}/photo", headers={"If-None-Match": served.headers["etag"]}).status_code == 304

    # The storefront's class card follows it, without any car having a photo.
    offer = _class_offer(_offers()[0], cls)

    assert offer["has_photo"] is True and offer["photo_version"] == uploaded.json()["photo_version"]

    removed = client.delete(f"/api/admin/vehicle-classes/{cls['id']}/photo")

    assert removed.json()["has_photo"] is False
    assert client.get(f"/api/public/offers/class-{cls['slug']}/photo").status_code == 404


def test_a_bad_photo_is_refused_and_the_audit_keeps_no_image(made):
    cls = _cls(made)

    bad = client.put(f"/api/admin/vehicle-classes/{cls['id']}/photo", json={"data_url": "data:text/plain;base64,aGk="})

    assert bad.status_code == 400 and bad.json()["code"] == "car_photo.wrong_type"

    client.put(f"/api/admin/vehicle-classes/{cls['id']}/photo", json={"data_url": _png()})

    db = SessionLocal()
    try:
        rows = db.scalars(
            select(AuditLog).where(AuditLog.entity_id == uuid.UUID(cls["id"]), AuditLog.action == "vehicle_class.photo_changed")
        ).all()
    finally:
        db.close()

    assert rows and all("base64" not in str(row.metadata_) for row in rows if hasattr(row, "metadata_"))


# --- order ------------------------------------------------------------------------------------


def test_the_order_is_saved_and_the_website_follows_it(storefront, made):
    first, second, third = (_cls(made) for _ in range(3))
    for row in (first, second, third):
        _car(made, row["id"])

    current = [row["id"] for row in client.get("/api/vehicle-classes").json()]
    mine = {first["id"], second["id"], third["id"]}
    others = [class_id for class_id in current if class_id not in mine]
    wanted = [third["id"], first["id"], second["id"]]

    assert client.put("/api/admin/vehicle-classes/order", json={"ids": wanted + others}).status_code == 204

    listed = [row["id"] for row in client.get("/api/vehicle-classes").json() if row["id"] in mine]
    assert listed == wanted

    keys = [item["offer_key"] for item in client.get("/api/public/fleet").json()]
    positions = [keys.index(f"class-{row['slug']}") for row in (third, first, second)]

    assert positions == sorted(positions)


def test_an_order_that_misses_or_repeats_a_class_is_refused(made):
    cls = _cls(made)
    current = [row["id"] for row in client.get("/api/vehicle-classes").json()]

    for ids in (current[:-1], current + [current[0]], current + [str(uuid.uuid4())]):
        response = client.put("/api/admin/vehicle-classes/order", json={"ids": ids})

        assert response.status_code == 400 and response.json()["code"] == "class.order_mismatch"

    assert cls["id"] in current


# --- cars in bulk ------------------------------------------------------------------------------


def test_cars_move_into_a_class_together_taking_its_price(made):
    cls = _cls(made, price="64.00")
    other = _cls(made, price="20.00")
    loose = _car(made, None, price="99.00")
    elsewhere = _car(made, other["id"])

    response = client.post(f"/api/admin/vehicle-classes/{cls['id']}/cars", json={"car_ids": [loose["id"], elsewhere["id"]]})

    assert response.status_code == 200 and response.json()["car_count"] == 2
    assert {client.get(f"/api/cars/{car['id']}").json()["price_per_day"] for car in (loose, elsewhere)} == {"64.00"}
    assert _listed()[other["id"]]["car_count"] == 0


def test_bulk_add_refuses_a_retired_class_and_an_unknown_car(made):
    cls = _cls(made)
    car = _car(made, None)

    assert client.post(f"/api/admin/vehicle-classes/{cls['id']}/cars", json={"car_ids": [str(uuid.uuid4())]}).status_code == 404

    client.post(f"/api/admin/vehicle-classes/{cls['id']}/retire")

    assert client.post(f"/api/admin/vehicle-classes/{cls['id']}/cars", json={"car_ids": [car["id"]]}).json()["code"] == "class.retired"
    assert client.post(f"/api/admin/vehicle-classes/{cls['id']}/cars", json={"car_ids": []}).status_code == 422


# --- removing -----------------------------------------------------------------------------------


def test_removing_an_unused_class_deletes_it_and_moves_its_cars(made):
    gone = _make_class("30.00")
    keep = _cls(made, price="45.00")
    car = _car(made, gone["id"])

    removed = client.post(f"/api/admin/vehicle-classes/{gone['id']}/remove", json={"move_cars_to": keep["id"]})

    assert removed.status_code == 200 and removed.json() == {"outcome": "deleted"}
    assert gone["id"] not in _listed(include_retired=True)

    moved = client.get(f"/api/cars/{car['id']}").json()

    assert moved["class_id"] == keep["id"] and moved["price_per_day"] == "45.00"


def test_removing_to_no_class_keeps_the_cars_and_their_price(made):
    gone = _make_class("31.00")
    car = _car(made, gone["id"])

    assert client.post(f"/api/admin/vehicle-classes/{gone['id']}/remove", json={}).json() == {"outcome": "deleted"}

    left = client.get(f"/api/cars/{car['id']}").json()

    assert left["class_id"] is None and left["price_per_day"] == "31.00"


def test_a_class_with_bookings_is_retired_not_deleted(made):
    cls = _make_class("30.00")
    car = _car(made, cls["id"])

    from datetime import datetime, timedelta, timezone

    from tests._dates import far_future_days

    start = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=far_future_days())
    booked = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Cfg", "last_name": "Test", "date_of_birth": "1990-01-01", "address": "x",
                "postal_code": "1", "phone_number": "+31600000009", "email": "cfg@example.com",
            },
            "class_id": cls["id"],
            "pickup_location_id": get_location_id("CAG"),
            "return_location_id": get_location_id("CAG"),
            "pickup_at": start.isoformat(),
            "return_at": (start + timedelta(days=2)).isoformat(),
        },
    )
    assert booked.status_code == 201, booked.text

    try:
        removed = client.post(f"/api/admin/vehicle-classes/{cls['id']}/remove", json={})

        assert removed.json() == {"outcome": "retired"}
        assert _listed(include_retired=True)[cls["id"]]["is_retired"] is True
        assert cls["id"] not in _listed()
        assert client.get(f"/api/cars/{car['id']}").json()["class_id"] is None
    finally:
        client.patch(f"/api/reservations/{booked.json()['id']}/cancel")


def test_a_class_cannot_be_removed_into_itself_or_into_a_retired_one(made):
    cls = _cls(made)
    other = _make_class()
    client.post(f"/api/admin/vehicle-classes/{other['id']}/retire")

    assert client.post(f"/api/admin/vehicle-classes/{cls['id']}/remove", json={"move_cars_to": cls["id"]}).json()["code"] == "class.cannot_move_into_itself"
    assert client.post(f"/api/admin/vehicle-classes/{cls['id']}/remove", json={"move_cars_to": other["id"]}).json()["code"] == "class.retired"
    assert client.post(f"/api/admin/vehicle-classes/{uuid.uuid4()}/remove", json={}).status_code == 404
