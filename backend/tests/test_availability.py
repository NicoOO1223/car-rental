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

    # SA-010 is under maintenance
    assert "SA-010-AA" not in license_plates


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