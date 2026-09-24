from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    force_reservation_status,
    get_location_id,
    set_car_location,
)

client = TestClient(app)

PLATE = "SA-006-AA"


def _away_car():
    """SA-006-AA (home: CAG) parked at Olbia; returns (car, home_id, away_id)."""
    car = ensure_car_available(PLATE)
    home_id = car["home_location"]["id"]
    away_id = get_location_id("OLB")

    assert home_id != away_id
    set_car_location(car["id"], away_id)

    return car, home_id, away_id


def test_car_reports_home_airport_and_is_not_away_by_default():
    car = ensure_car_available(PLATE)
    body = client.get(f"/api/cars/{car['id']}").json()

    assert body["home_location"]["airport_code"] == body["current_location"]["airport_code"]
    assert body["is_away_from_home"] is False


def test_car_away_from_home_is_flagged_and_listed_on_the_dashboard():
    car, home_id, away_id = _away_car()

    try:
        body = client.get(f"/api/cars/{car['id']}").json()
        assert body["is_away_from_home"] is True
        assert body["current_location"]["id"] == away_id
        assert body["home_location"]["id"] == home_id

        dashboard = client.get("/api/dashboard").json()
        away = {c["license_plate"]: c for c in dashboard["cars_away_from_home"]}
        assert away[PLATE]["current_airport_code"] == "OLB"
        assert away[PLATE]["home_airport_code"] == "CAG"
        assert away[PLATE]["current_airport_name"]
        assert away[PLATE]["home_airport_name"]
        assert away[PLATE]["status"] in ("AVAILABLE", "MAINTENANCE", "CLEANING", "RENTED", "RESERVED")
        assert away[PLATE]["year"] > 1990
    finally:
        set_car_location(car["id"], home_id)


def test_current_location_can_no_longer_be_edited_by_hand():
    car = ensure_car_available(PLATE)

    response = client.patch(
        f"/api/cars/{car['id']}",
        json={"current_location_id": get_location_id("AHO")},
    )

    assert response.status_code == 422


def test_home_airport_is_editable():
    car = ensure_car_available(PLATE)
    original_home = car["home_location"]["id"]
    new_home = get_location_id("AHO")

    try:
        response = client.patch(
            f"/api/cars/{car['id']}", json={"home_location_id": new_home}
        )

        assert response.status_code == 200
        assert response.json()["home_location"]["id"] == new_home
        # It was at its old home, so it is now away from the new one.
        assert response.json()["is_away_from_home"] is True
    finally:
        client.patch(
            f"/api/cars/{car['id']}", json={"home_location_id": original_home}
        )


def test_return_to_home_moves_the_car_and_is_audited():
    car, home_id, _ = _away_car()

    response = client.post(f"/api/cars/{car['id']}/return-to-home")

    assert response.status_code == 200
    assert response.json()["is_away_from_home"] is False
    assert response.json()["current_location"]["id"] == home_id

    db = SessionLocal()
    try:
        rows = (
            db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "car",
                AuditLog.entity_id == UUID(car["id"]),
                AuditLog.action == "car.relocated",
            )
            .all()
        )
        assert rows and rows[-1].details == {"from": "OLB", "to": "CAG"}
    finally:
        db.close()


def test_return_to_home_rejected_when_already_home():
    car = ensure_car_available(PLATE)

    response = client.post(f"/api/cars/{car['id']}/return-to-home")

    assert response.status_code == 400
    assert "already at its home airport" in response.json()["detail"]


def test_return_to_home_404_for_unknown_car():
    assert client.post(f"/api/cars/{uuid4()}/return-to-home").status_code == 404


def test_return_to_home_blocked_by_reservation_picking_up_at_the_away_airport():
    car, home_id, away_id = _away_car()
    now = datetime.now(timezone.utc)

    reservation = create_reservation(
        car["id"],
        away_id,
        (now + timedelta(days=200)).isoformat(),
        (now + timedelta(days=202)).isoformat(),
    )

    try:
        response = client.post(f"/api/cars/{car['id']}/return-to-home")

        assert response.status_code == 400
        assert reservation["id"][:8].upper() in response.json()["detail"]
    finally:
        force_reservation_status(reservation["id"], "CANCELLED")
        set_car_location(car["id"], home_id)
