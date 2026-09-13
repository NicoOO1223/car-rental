from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import Car, Reservation


client = TestClient(app)


def get_olb_id():
    locations = client.get("/api/locations").json()

    return next(
        location["id"]
        for location in locations
        if location["airport_code"] == "OLB"
    )


def get_location_id(airport_code: str) -> str:
    locations = client.get("/api/locations").json()

    return next(
        location["id"]
        for location in locations
        if location["airport_code"] == airport_code
    )


def get_car_by_plate(plate: str) -> dict:
    cars = client.get("/api/cars").json()

    return next(
        car
        for car in cars
        if car["license_plate"] == plate
    )


def ensure_car_available(plate: str) -> dict:
    """
    The dev database is shared with manual/UI testing, and car status
    is directly editable there. Reservation-creation tests need their
    target car to be AVAILABLE regardless of whatever state it was
    last left in — force it before relying on it.
    """
    car = get_car_by_plate(plate)

    client.patch(
        f"/api/cars/{car['id']}",
        json={"status": "AVAILABLE"},
    )

    return car


def force_reservation_status(
    reservation_id: str,
    status: str,
    car_status: str | None = None,
) -> None:
    """
    Test-only backdoor: writes Reservation.status (and optionally
    Car.status) directly via a raw DB session, bypassing all API business
    rules. ACTIVE is only reachable in the real app via the handover flow
    (payment + signature + generated agreement, see
    app/services/handovers.py), which real Stripe/PDF-generation tests
    cover separately in test_handovers.py. This helper exists purely to
    set up a COMPLETED/ACTIVE *precondition* for tests that exercise
    unrelated behavior (e.g. that editing a completed reservation is
    rejected) without depending on Stripe credentials being configured.
    """
    db = SessionLocal()

    try:
        reservation = db.get(Reservation, reservation_id)
        reservation.status = status

        if car_status is not None:
            db.get(Car, reservation.car_id).status = car_status

        db.commit()
    finally:
        db.close()


def create_reservation(
    car_id: str,
    location_id: str,
    pickup_at: str,
    return_at: str,
    extras: list | None = None,
) -> dict:
    payload = {
        "customer": {
            "first_name": "Test",
            "last_name": "User",
            "date_of_birth": "1995-01-01",
            "address": "Test Street 1",
            "postal_code": "1000AA",
            "phone_number": "+31600000000",
            "email": "test.user@example.com",
        },
        "car_id": car_id,
        "pickup_location_id": location_id,
        "return_location_id": location_id,
        "pickup_at": pickup_at,
        "return_at": return_at,
    }

    # Only sent when asked for, so the no-extras path stays exactly what
    # every pre-existing caller of this helper was testing.
    if extras is not None:
        payload["extras"] = extras

    response = client.post("/api/reservations", json=payload)

    assert response.status_code == 201

    return response.json()


def test_reservation_with_invalid_dates():
    olb_id = get_olb_id()

    cars = client.get("/api/cars").json()
    car_id = cars[0]["id"]

    response = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Test",
                "last_name": "User",
                "date_of_birth": "1995-01-01",
                "address": "Test Street 1",
                "postal_code": "1000AA",
                "phone_number": "+31600000000",
                "email": "test.user@example.com",
            },
            "car_id": car_id,
            "pickup_location_id": olb_id,
            "return_location_id": olb_id,
            "pickup_at": "2026-08-30T10:00:00Z",
            "return_at": "2026-08-26T10:00:00Z",
        },
    )

    assert response.status_code == 400


def test_update_reservation_happy_path():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation(
        car["id"],
        aho_id,
        "2026-10-01T10:00:00Z",
        "2026-10-03T10:00:00Z",
    )

    response = client.patch(
        f"/api/reservations/{reservation['id']}",
        json={
            "pickup_at": "2026-10-02T10:00:00Z",
            "return_at": "2026-10-04T10:00:00Z",
        },
    )

    assert response.status_code == 200

    updated = response.json()

    assert updated["pickup_at"] == "2026-10-02T10:00:00Z"
    assert updated["return_at"] == "2026-10-04T10:00:00Z"

    # Clean up: cancelled reservations don't count toward
    # future conflict checks.
    client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_update_reservation_date_conflict_rejected():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    # SA-007-AA's status reflects a real ongoing rental in this shared
    # dev database (not just seed data) — force it AVAILABLE only long
    # enough to create the reservation below, then restore it, rather
    # than permanently clobbering that state.
    other_car = get_car_by_plate("SA-007-AA")
    original_other_car_status = other_car["status"]
    client.patch(f"/api/cars/{other_car['id']}", json={"status": "AVAILABLE"})

    blocking = create_reservation(
        car["id"],
        aho_id,
        "2026-10-10T10:00:00Z",
        "2026-10-12T10:00:00Z",
    )

    other = create_reservation(
        other_car["id"],
        aho_id,
        "2026-10-20T10:00:00Z",
        "2026-10-22T10:00:00Z",
    )

    response = client.patch(
        f"/api/reservations/{other['id']}",
        json={
            "car_id": car["id"],
            "pickup_at": "2026-10-11T10:00:00Z",
            "return_at": "2026-10-13T10:00:00Z",
        },
    )

    assert response.status_code == 400
    assert "already reserved" in response.json()["detail"]

    client.patch(f"/api/reservations/{blocking['id']}/cancel")
    client.patch(f"/api/reservations/{other['id']}/cancel")
    client.patch(
        f"/api/cars/{other_car['id']}",
        json={"status": original_other_car_status},
    )


def test_update_reservation_cancelled_rejected():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation(
        car["id"],
        aho_id,
        "2026-10-30T10:00:00Z",
        "2026-11-01T10:00:00Z",
    )

    cancel_response = client.patch(
        f"/api/reservations/{reservation['id']}/cancel"
    )
    assert cancel_response.status_code == 200

    response = client.patch(
        f"/api/reservations/{reservation['id']}",
        json={"return_at": "2026-11-02T10:00:00Z"},
    )

    assert response.status_code == 400
    assert "cancelled" in response.json()["detail"].lower()


def test_update_reservation_completed_rejected():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation(
        car["id"],
        aho_id,
        "2026-11-10T10:00:00Z",
        "2026-11-12T10:00:00Z",
    )

    # ACTIVE is only reachable via the handover flow now — jump straight
    # to COMPLETED since this test only cares about COMPLETED's
    # edit-blocking effect, not how COMPLETED was reached.
    force_reservation_status(reservation["id"], "COMPLETED")

    response = client.patch(
        f"/api/reservations/{reservation['id']}",
        json={"return_at": "2026-11-13T10:00:00Z"},
    )

    assert response.status_code == 400
    assert "completed" in response.json()["detail"].lower()


def test_update_reservation_not_found():
    response = client.patch(
        f"/api/reservations/{uuid4()}",
        json={"return_at": "2026-12-01T10:00:00Z"},
    )

    assert response.status_code == 404


def test_update_reservation_customer_fields():
    aho_id = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    reservation = create_reservation(
        car["id"],
        aho_id,
        "2026-12-10T10:00:00Z",
        "2026-12-12T10:00:00Z",
    )

    response = client.patch(
        f"/api/reservations/{reservation['id']}",
        json={"customer": {"address": "New Address 99"}},
    )

    assert response.status_code == 200

    fetched = client.get(
        f"/api/reservations/{reservation['id']}"
    ).json()

    assert fetched["customer"]["address"] == "New Address 99"

    client.patch(f"/api/reservations/{reservation['id']}/cancel")