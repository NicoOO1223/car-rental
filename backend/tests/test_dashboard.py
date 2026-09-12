from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import (
    force_reservation_status,
    get_car_by_plate,
    get_location_id,
)


client = TestClient(app)

ALL_PLATES = [f"SA-{i:03d}-AA" for i in range(1, 11)]


def find_reservation_id(car_id: str, pickup_date_prefix: str) -> str:
    reservations = client.get(f"/api/cars/{car_id}/reservations").json()

    return next(
        r["id"]
        for r in reservations
        if r["pickup_at"].startswith(pickup_date_prefix)
    )


def snapshot_and_set_location(plate: str, airport_code: str) -> str:
    """
    Force a car to a specific location for the duration of a test that
    assumes seed.py's original fleet-by-location topology, and return its
    real current airport code so it can be restored afterward -- cars are
    directly relocatable via the car-edit modal in the live app, so this
    can't be assumed to stay fixed across sessions.
    """
    car = get_car_by_plate(plate)
    original_airport_code = car["current_location"]["airport_code"]

    client.patch(
        f"/api/cars/{car['id']}",
        json={"current_location_id": get_location_id(airport_code)},
    )

    return original_airport_code


def restore_location(plate: str, airport_code: str) -> None:
    car = get_car_by_plate(plate)

    client.patch(
        f"/api/cars/{car['id']}",
        json={"current_location_id": get_location_id(airport_code)},
    )


def snapshot_and_set_statuses(overrides: dict) -> dict:
    """
    The dev database is shared with manual/UI testing, and car status is
    directly editable there -- a live status changed outside this test
    run would otherwise make these assertions flaky. Force every car to
    AVAILABLE, then apply the specific overrides these tests actually
    depend on, and return the original statuses so they can be restored.
    """

    originals = {}

    for plate in ALL_PLATES:
        car = get_car_by_plate(plate)
        originals[plate] = car["status"]
        client.patch(f"/api/cars/{car['id']}", json={"status": "AVAILABLE"})

    for plate, status in overrides.items():
        car = get_car_by_plate(plate)
        client.patch(f"/api/cars/{car['id']}", json={"status": status})

    return originals


def restore_statuses(originals: dict):
    for plate, status in originals.items():
        car = get_car_by_plate(plate)
        client.patch(f"/api/cars/{car['id']}", json={"status": status})


def test_fleet_status_olb_2026_08_22():
    originals = snapshot_and_set_statuses({"SA-010-AA": "MAINTENANCE"})

    # seed.py's SA-002-AA reservation covering this day was ACTIVE; by now
    # (real elapsed time in this shared dev DB) it has genuinely been
    # completed via the app itself. Force it back to ACTIVE for this test
    # -- which is specifically about the RENTED bucket -- and restore it
    # to COMPLETED afterward rather than leaving it permanently altered.
    sa002 = get_car_by_plate("SA-002-AA")
    active_reservation_id = find_reservation_id(sa002["id"], "2026-08-20")
    force_reservation_status(active_reservation_id, "ACTIVE")

    try:
        olb_id = get_location_id("OLB")

        response = client.get(
            "/api/dashboard/fleet-status",
            params={"date": "2026-08-22", "location_id": olb_id},
        )

        assert response.status_code == 200

        counts = response.json()["counts"]

        # SA-002-AA has an ACTIVE reservation covering this day -> RENTED.
        # SA-003-AA has a CANCELLED reservation covering this day, which
        # must be ignored, and a later CONFIRMED reservation that doesn't
        # overlap this date -> AVAILABLE.
        # SA-010-AA has no reservations but a live MAINTENANCE status,
        # carried through as-is.
        assert counts == {
            "total": 4,
            "available": 2,
            "reserved": 0,
            "rented": 1,
            "maintenance": 1,
            "cleaning": 0,
        }
    finally:
        restore_statuses(originals)
        force_reservation_status(active_reservation_id, "COMPLETED")


def test_fleet_status_cagliari_2026_08_26():
    originals = snapshot_and_set_statuses({})

    # SA-006-AA has since been relocated away from Cagliari via the live
    # car-edit modal -- force it back for this test, which assumes
    # seed.py's original 3-car Cagliari fleet, and restore its real
    # location afterward.
    sa006_original_airport = snapshot_and_set_location("SA-006-AA", "CAG")

    try:
        cag_id = get_location_id("CAG")

        response = client.get(
            "/api/dashboard/fleet-status",
            params={"date": "2026-08-26", "location_id": cag_id},
        )

        assert response.status_code == 200

        counts = response.json()["counts"]

        # SA-004-AA has a CONFIRMED reservation covering this day -> RESERVED.
        # SA-006-AA's live Car.status is forced to AVAILABLE above and has
        # zero reservation rows at all -- by design, this endpoint derives
        # RENTED/RESERVED purely from reservation data. Elsewhere in this
        # app (seed data), SA-006-AA's live status is actually "RENTED"
        # with no reservation backing it, which would still show as
        # AVAILABLE here even without this test's forced reset -- that's
        # the documented, intentional inconsistency between this endpoint
        # and /api/cars / the main /api/dashboard endpoint, not a bug.
        assert counts["total"] == 3
        assert counts["available"] == 2
        assert counts["reserved"] == 1
        assert counts["rented"] == 0
    finally:
        restore_statuses(originals)
        restore_location("SA-006-AA", sa006_original_airport)


def test_fleet_status_alghero_2026_08_26():
    originals = snapshot_and_set_statuses({"SA-009-AA": "CLEANING"})

    # Counterpart to the Cagliari test above -- make sure SA-006-AA isn't
    # sitting in Alghero (its current real location) while this test
    # asserts Alghero's original 3-car seed.py topology either.
    sa006_original_airport = snapshot_and_set_location("SA-006-AA", "CAG")

    # seed.py's SA-007-AA reservation covering this day was CONFIRMED; by
    # now it has genuinely gone through the real handover flow (payment +
    # signature + agreement) via the live app and is ACTIVE. Force it back
    # to CONFIRMED for this test -- which is specifically about the
    # RESERVED bucket -- and restore it to ACTIVE afterward.
    sa007 = get_car_by_plate("SA-007-AA")
    confirmed_reservation_id = find_reservation_id(sa007["id"], "2026-08-24")
    force_reservation_status(confirmed_reservation_id, "CONFIRMED")

    try:
        aho_id = get_location_id("AHO")

        response = client.get(
            "/api/dashboard/fleet-status",
            params={"date": "2026-08-26", "location_id": aho_id},
        )

        assert response.status_code == 200

        counts = response.json()["counts"]

        # SA-007-AA has a CONFIRMED reservation covering this day -> RESERVED.
        # SA-009-AA has no reservations but a live CLEANING status, carried
        # through as-is.
        assert counts["total"] == 3
        assert counts["available"] == 1
        assert counts["reserved"] == 1
        assert counts["cleaning"] == 1
    finally:
        restore_statuses(originals)
        restore_location("SA-006-AA", sa006_original_airport)
        force_reservation_status(confirmed_reservation_id, "ACTIVE")


def test_fleet_status_no_filters_far_past_date():
    originals = snapshot_and_set_statuses(
        {"SA-010-AA": "MAINTENANCE", "SA-009-AA": "CLEANING"}
    )

    try:
        response = client.get(
            "/api/dashboard/fleet-status",
            params={"date": "2020-01-01"},
        )

        assert response.status_code == 200

        counts = response.json()["counts"]

        # No reservation overlaps this date at all, so every car falls
        # through to AVAILABLE except the two forced above.
        assert counts["total"] == 10
        assert counts["maintenance"] == 1
        assert counts["cleaning"] == 1
        assert counts["available"] == 8
        assert counts["reserved"] == 0
        assert counts["rented"] == 0
    finally:
        restore_statuses(originals)


def test_fleet_status_defaults_to_today():
    response = client.get("/api/dashboard/fleet-status")

    assert response.status_code == 200

    today = datetime.now(timezone.utc).date().isoformat()
    assert response.json()["date"] == today


def test_fleet_status_unknown_location_returns_empty():
    response = client.get(
        "/api/dashboard/fleet-status",
        params={"location_id": str(uuid4())},
    )

    assert response.status_code == 200

    counts = response.json()["counts"]

    assert counts == {
        "total": 0,
        "available": 0,
        "reserved": 0,
        "rented": 0,
        "maintenance": 0,
        "cleaning": 0,
    }
