from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def get_olb_id():
    response = client.get("/api/locations")

    assert response.status_code == 200

    locations = response.json()

    olb = next(
        location
        for location in locations
        if location["airport_code"] == "OLB"
    )

    return olb["id"]


def test_available_cars():
    olb_id = get_olb_id()

    response = client.get(
        "/api/cars/available",
        params={
            "location_id": olb_id,
            "pickup_at": "2026-08-26T10:00:00Z",
            "return_at": "2026-08-30T10:00:00Z",
        },
    )

    assert response.status_code == 200

    cars = response.json()

    license_plates = {
        car["license_plate"]
        for car in cars
    }

    assert "SA-001-AA" in license_plates
    assert "SA-002-AA" in license_plates

    # SA-003 has a conflicting reservation
    assert "SA-003-AA" not in license_plates

    # SA-010's maintenance task opened on 11 Sep and has no end yet, so it is
    # not offered for a rental after that (it is offered before it, as the
    # work had not started).
    later = client.get(
        "/api/cars/available",
        params={
            "location_id": olb_id,
            "pickup_at": "2026-09-20T10:00:00Z",
            "return_at": "2026-09-24T10:00:00Z",
        },
    )

    assert "SA-010-AA" not in {car["license_plate"] for car in later.json()}


def test_invalid_reservation_period():
    olb_id = get_olb_id()

    response = client.get(
        "/api/cars/available",
        params={
            "location_id": olb_id,
            "pickup_at": "2026-08-30T10:00:00Z",
            "return_at": "2026-08-26T10:00:00Z",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Return time must be after pickup time."
    )

def test_availability_is_a_single_query_regardless_of_fleet_size():
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import event, select

    from app.database import SessionLocal, engine
    from app.models import Location
    from app.services.availability import get_available_cars

    db = SessionLocal()
    statements = []

    def count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    try:
        location_id = db.scalar(select(Location.id).limit(1))
        pickup = datetime.now(timezone.utc) + timedelta(days=9000)

        event.listen(engine, "before_cursor_execute", count)
        try:
            get_available_cars(db, location_id, pickup, pickup + timedelta(days=2))
        finally:
            event.remove(engine, "before_cursor_execute", count)
    finally:
        db.close()

    assert len(statements) == 1
