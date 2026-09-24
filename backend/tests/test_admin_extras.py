from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.main import app
from app.models import AuditLog, Extra, ReservationExtra, User

from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    get_location_id,
)

client = TestClient(app)

SEEDED_CODES = {
    "ADDITIONAL_DRIVER",
    "REFUELING_SERVICE",
    "PASSENGER_INSURANCE",
    "INTERIOR_COVERAGE",
    "BABY_SEAT",
    "CHILD_SEAT",
}


@pytest.fixture(autouse=True)
def _remove_extras_created_by_the_test():
    """
    Extras can't be deleted through the app, so tests would leave a growing
    pile of retired rows in the shared dev database. Remove the ones they
    created, along with the lines the tests' own (cancelled) bookings hold
    on them.
    """

    yield

    db = SessionLocal()
    try:
        test_extra_ids = select(Extra.id).where(Extra.code.notin_(SEEDED_CODES))

        db.execute(
            delete(ReservationExtra).where(ReservationExtra.extra_id.in_(test_extra_ids))
        )
        db.execute(delete(Extra).where(Extra.code.notin_(SEEDED_CODES)))
        db.commit()
    finally:
        db.close()


def _create(**overrides) -> dict:
    payload = {
        "name": f"Test extra {uuid4().hex[:6]}",
        "description": "Created by a test",
        "price": "12.50",
        "price_unit": "PER_DAY",
        "max_quantity": 2,
    }
    payload.update(overrides)

    response = client.post("/api/admin/extras", json=payload)
    assert response.status_code == 201, response.text

    return response.json()


def _retire(extra_id: str) -> None:
    client.patch(f"/api/admin/extras/{extra_id}", json={"is_active": False})


def _audit_actions(extra_id: str) -> list[str]:
    db = SessionLocal()

    try:
        return [
            row.action
            for row in db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "extra",
                AuditLog.entity_id == UUID(extra_id),
            )
            .order_by(AuditLog.created_at)
        ]
    finally:
        db.close()


def _as_staff():
    app.dependency_overrides[get_current_user] = lambda: User(
        id=UUID("00000000-0000-0000-0000-000000000000"),
        email="test-suite@example.com",
        hashed_password="unused",
        role="staff",
        is_active=True,
    )


def _catalog_ids() -> set[str]:
    return {extra["id"] for extra in client.get("/api/extras").json()}


def test_staff_cannot_manage_extras():
    extra = _create()
    _as_staff()

    try:
        assert client.get("/api/admin/extras").status_code == 403
        assert (
            client.post(
                "/api/admin/extras",
                json={"name": "x", "price": "1", "price_unit": "PER_DAY"},
            ).status_code
            == 403
        )
        assert (
            client.patch(
                f"/api/admin/extras/{extra['id']}", json={"price": "1"}
            ).status_code
            == 403
        )
        assert (
            client.put("/api/admin/extras/order", json={"ids": []}).status_code == 403
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: User(
        id=UUID("00000000-0000-0000-0000-000000000000"),
        email="test-suite@example.com",
        hashed_password="unused",
        role="admin",
        is_active=True,
    )
    _retire(extra["id"])


def test_create_extra_generates_a_unique_code_and_is_audited():
    name = f"Roof rack {uuid4().hex[:4]}"
    first = _create(name=name)
    second = _create(name=name)

    try:
        assert first["code"].startswith("ROOF_RACK_")
        assert second["code"] != first["code"]
        assert first["is_active"] is True
        assert first["price"] == "12.50"
        assert first["id"] in _catalog_ids()
        assert _audit_actions(first["id"]) == ["extra.created"]
    finally:
        _retire(first["id"])
        _retire(second["id"])


def test_create_extra_validation():
    base = {"name": "Bad", "price": "5", "price_unit": "PER_DAY"}

    assert client.post("/api/admin/extras", json={**base, "name": ""}).status_code == 422
    assert client.post("/api/admin/extras", json={**base, "price": "-1"}).status_code == 422
    assert (
        client.post("/api/admin/extras", json={**base, "price_unit": "PER_WEEK"}).status_code
        == 422
    )
    assert (
        client.post("/api/admin/extras", json={**base, "max_quantity": 0}).status_code == 422
    )


def test_update_extra_changes_fields_and_audits_the_diff():
    extra = _create(price="10.00")

    try:
        response = client.patch(
            f"/api/admin/extras/{extra['id']}",
            json={"price": "15.00", "name": "Renamed extra", "max_quantity": 3},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["price"] == "15.00"
        assert body["name"] == "Renamed extra"
        assert body["max_quantity"] == 3
        assert body["code"] == extra["code"]

        db = SessionLocal()
        try:
            row = (
                db.query(AuditLog)
                .filter(
                    AuditLog.entity_id == UUID(extra["id"]),
                    AuditLog.action == "extra.updated",
                )
                .one()
            )
            assert row.details["price"] == {"old": "10.00", "new": "15.00"}
        finally:
            db.close()

        # No change, no audit row.
        client.patch(f"/api/admin/extras/{extra['id']}", json={"price": "15.00"})
        assert _audit_actions(extra["id"]).count("extra.updated") == 1
    finally:
        _retire(extra["id"])


def test_code_cannot_be_edited():
    extra = _create()

    try:
        response = client.patch(
            f"/api/admin/extras/{extra['id']}", json={"code": "HIJACKED"}
        )

        assert response.status_code == 422
    finally:
        _retire(extra["id"])


def test_retiring_hides_from_the_catalog_and_reactivating_restores_it():
    extra = _create()

    retired = client.patch(f"/api/admin/extras/{extra['id']}", json={"is_active": False})
    assert retired.status_code == 200
    assert extra["id"] not in _catalog_ids()

    everything = client.get("/api/admin/extras").json()
    assert extra["id"] in {e["id"] for e in everything}

    client.patch(f"/api/admin/extras/{extra['id']}", json={"is_active": True})
    assert extra["id"] in _catalog_ids()

    assert _audit_actions(extra["id"]) == [
        "extra.created",
        "extra.retired",
        "extra.reactivated",
    ]

    _retire(extra["id"])


def test_unknown_extra_is_404():
    assert (
        client.patch(f"/api/admin/extras/{uuid4()}", json={"price": "1"}).status_code == 404
    )


def test_reorder_extras():
    a = _create()
    b = _create()

    try:
        current = [e["id"] for e in client.get("/api/admin/extras").json()]
        swapped = current.copy()
        i, j = swapped.index(a["id"]), swapped.index(b["id"])
        swapped[i], swapped[j] = swapped[j], swapped[i]

        response = client.put("/api/admin/extras/order", json={"ids": swapped})

        assert response.status_code == 200
        assert [e["id"] for e in response.json()] == swapped
        assert [e["id"] for e in client.get("/api/admin/extras").json()] == swapped

        # Restore the original order.
        client.put("/api/admin/extras/order", json={"ids": current})

        missing_one = client.put("/api/admin/extras/order", json={"ids": current[:-1]})
        assert missing_one.status_code == 400
    finally:
        _retire(a["id"])
        _retire(b["id"])


def test_price_change_does_not_reprice_an_existing_booking_and_retired_extra_stays_editable():
    extra = _create(price="10.00", max_quantity=3)
    car = ensure_car_available("SA-002-AA")
    location_id = car["current_location"]["id"]

    reservation = create_reservation(
        car["id"],
        location_id,
        "2032-03-01T10:00:00Z",
        "2032-03-03T10:00:00Z",
        extras=[{"extra_id": extra["id"], "quantity": 1}],
    )

    try:
        client.patch(f"/api/admin/extras/{extra['id']}", json={"price": "99.00"})
        _retire(extra["id"])

        booked = client.get(f"/api/reservations/{reservation['id']}").json()
        line = next(l for l in booked["extras"] if l["extra_code"] == extra["code"])
        assert line["unit_price"] == "10.00"

        # The booking can still be edited with the retired extra on it.
        edited = client.patch(
            f"/api/reservations/{reservation['id']}",
            json={"extras": [{"extra_id": extra["id"], "quantity": 2}]},
        )
        assert edited.status_code == 200
        assert edited.json()["extras"][0]["unit_price"] == "10.00"
        assert edited.json()["extras"][0]["quantity"] == 2

        # ...but no new booking can pick it.
        other = create_reservation  # noqa: F841 - documents intent below
        response = client.post(
            "/api/reservations/quote",
            json={
                "car_id": car["id"],
                "pickup_location_id": location_id,
                "return_location_id": location_id,
                "pickup_at": "2032-05-01T10:00:00Z",
                "return_at": "2032-05-03T10:00:00Z",
                "extras": [{"extra_id": extra["id"], "quantity": 1}],
            },
        )
        assert response.status_code == 400
        assert "no longer available" in response.json()["detail"]
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_extras_are_not_deletable():
    extra = _create()

    try:
        assert client.delete(f"/api/admin/extras/{extra['id']}").status_code == 405
    finally:
        _retire(extra["id"])
