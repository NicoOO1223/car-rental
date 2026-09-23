from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
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

    # seed.py's SA-004-AA reservation covering this day was CONFIRMED; by
    # now (real elapsed time in this shared dev DB) it has genuinely gone
    # through the real handover flow and is ACTIVE. Force it back to
    # CONFIRMED for this test -- which is specifically about the RESERVED
    # bucket -- and restore it to ACTIVE afterward. Same fix already
    # applied to the OLB/Alghero variants of this test below for their
    # own cars.
    sa004 = get_car_by_plate("SA-004-AA")
    confirmed_reservation_id = find_reservation_id(sa004["id"], "2026-08-25")
    force_reservation_status(confirmed_reservation_id, "CONFIRMED")

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
        force_reservation_status(confirmed_reservation_id, "ACTIVE")


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


# --- Fleet by location -----------------------------------------------------


def test_fleet_by_location_ignores_car_status_with_no_reservation():
    """
    GET /api/dashboard's "locations" breakdown must derive RENTED/RESERVED
    from actual reservation data, not from the live Car.status field --
    that field is directly editable (e.g. via the car-edit modal) and can
    say RENTED indefinitely with no reservation ever backing it.
    """

    originals = snapshot_and_set_statuses({"SA-006-AA": "RENTED"})

    try:
        car = get_car_by_plate("SA-006-AA")

        response = client.get("/api/dashboard")
        assert response.status_code == 200

        location_stats = next(
            location
            for location in response.json()["locations"]
            if location["airport_code"] == car["current_location"]["airport_code"]
        )

        # The car's live status says RENTED, but with zero reservations
        # backing it, it must fall back to available rather than
        # inflating the "rented" bucket for its airport.
        assert location_stats["rented"] == 0
    finally:
        restore_statuses(originals)


def test_fleet_by_location_reflects_a_real_active_rental():
    """
    Counterpart to the test above: a reservation that genuinely overlaps
    today, once ACTIVE, must still count as RENTED -- confirming the
    derivation isn't just always reporting available. Uses a fresh
    reservation spanning today rather than a seed date, since the
    derivation is "as of today", not as of any historical date.
    """

    car = ensure_car_available("SA-009-AA")
    now = datetime.now(timezone.utc)

    reservation = create_reservation(
        car["id"],
        car["current_location"]["id"],
        (now - timedelta(hours=1)).isoformat(),
        (now + timedelta(hours=6)).isoformat(),
    )

    force_reservation_status(reservation["id"], "ACTIVE")

    try:
        response = client.get("/api/dashboard")
        assert response.status_code == 200

        location_stats = next(
            location
            for location in response.json()["locations"]
            if location["airport_code"] == car["current_location"]["airport_code"]
        )

        assert location_stats["rented"] >= 1
    finally:
        force_reservation_status(reservation["id"], "CANCELLED")


# --- Upcoming pickups / upcoming returns ---------------------------------


def test_upcoming_returns_includes_in_progress_rental():
    """
    A rental that has already started (past pickup, future return) is the
    case upcoming_returns exists for -- it must not be missing just
    because upcoming_pickups' own filter (pickup_at >= now) obviously
    excludes it.
    """

    car = ensure_car_available("SA-005-AA")
    now = datetime.now(timezone.utc)

    reservation = create_reservation(
        car["id"],
        car["current_location"]["id"],
        (now - timedelta(minutes=5)).isoformat(),
        (now + timedelta(minutes=30)).isoformat(),
    )

    force_reservation_status(reservation["id"], "ACTIVE")

    try:
        response = client.get("/api/dashboard")
        assert response.status_code == 200

        body = response.json()
        pickup_ids = {r["id"] for r in body["upcoming_pickups"]}
        return_ids = {r["id"] for r in body["upcoming_returns"]}

        assert reservation["id"] in return_ids
        assert reservation["id"] not in pickup_ids
    finally:
        force_reservation_status(reservation["id"], "CANCELLED")


def test_upcoming_returns_excludes_bookings_not_yet_started():
    """
    The bug the naive mirrored query (return_at >= now alone) would have
    had: a booking that hasn't started yet also has a return date in the
    future, but it must not show up in "returns" -- only a rental that is
    genuinely in progress belongs there.
    """

    car = ensure_car_available("SA-006-AA")
    now = datetime.now(timezone.utc)

    reservation = create_reservation(
        car["id"],
        car["current_location"]["id"],
        (now + timedelta(days=10)).isoformat(),
        (now + timedelta(days=13)).isoformat(),
    )

    try:
        response = client.get("/api/dashboard")
        assert response.status_code == 200

        body = response.json()
        pickup_ids = {r["id"] for r in body["upcoming_pickups"]}
        return_ids = {r["id"] for r in body["upcoming_returns"]}

        assert reservation["id"] in pickup_ids
        assert reservation["id"] not in return_ids
    finally:
        force_reservation_status(reservation["id"], "CANCELLED")


def test_upcoming_lists_exclude_cancelled():
    car = ensure_car_available("SA-007-AA")
    now = datetime.now(timezone.utc)

    reservation = create_reservation(
        car["id"],
        car["current_location"]["id"],
        (now + timedelta(days=5)).isoformat(),
        (now + timedelta(days=8)).isoformat(),
    )

    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    response = client.get("/api/dashboard")
    assert response.status_code == 200

    body = response.json()
    pickup_ids = {r["id"] for r in body["upcoming_pickups"]}
    return_ids = {r["id"] for r in body["upcoming_returns"]}

    assert reservation["id"] not in pickup_ids
    assert reservation["id"] not in return_ids


def test_upcoming_pickups_includes_customer_phone_number():
    car = ensure_car_available("SA-005-AA")
    now = datetime.now(timezone.utc)

    reservation = create_reservation(
        car["id"],
        car["current_location"]["id"],
        (now + timedelta(days=1)).isoformat(),
        (now + timedelta(days=3)).isoformat(),
    )

    try:
        response = client.get("/api/dashboard")
        assert response.status_code == 200

        row = next(
            r
            for r in response.json()["upcoming_pickups"]
            if r["id"] == reservation["id"]
        )
        assert row["customer_phone_number"] == "+31600000000"
    finally:
        force_reservation_status(reservation["id"], "CANCELLED")


def test_dashboard_date_range_excludes_pickups_outside_window():
    car = ensure_car_available("SA-006-AA")
    now = datetime.now(timezone.utc)

    in_range = create_reservation(
        car["id"],
        car["current_location"]["id"],
        (now + timedelta(days=2)).isoformat(),
        (now + timedelta(days=4)).isoformat(),
    )

    try:
        out_of_range = create_reservation(
            car["id"],
            car["current_location"]["id"],
            (now + timedelta(days=40)).isoformat(),
            (now + timedelta(days=42)).isoformat(),
        )

        try:
            start = (now + timedelta(days=1)).date().isoformat()
            end = (now + timedelta(days=5)).date().isoformat()

            response = client.get(
                "/api/dashboard",
                params={"start_date": start, "end_date": end},
            )
            assert response.status_code == 200

            pickup_ids = {
                r["id"] for r in response.json()["upcoming_pickups"]
            }
            assert in_range["id"] in pickup_ids
            assert out_of_range["id"] not in pickup_ids
        finally:
            force_reservation_status(out_of_range["id"], "CANCELLED")
    finally:
        force_reservation_status(in_range["id"], "CANCELLED")


def test_dashboard_date_range_returns_includes_not_yet_started_booking():
    """
    Unlike the default (no-range) view, an explicit range on the returns
    list isn't restricted to rentals already in progress — a booking
    whose return_at falls in the requested window belongs there even if
    it hasn't been picked up yet.
    """

    car = ensure_car_available("SA-007-AA")
    now = datetime.now(timezone.utc)

    reservation = create_reservation(
        car["id"],
        car["current_location"]["id"],
        (now + timedelta(days=30)).isoformat(),
        (now + timedelta(days=32)).isoformat(),
    )

    try:
        start = (now + timedelta(days=29)).date().isoformat()
        end = (now + timedelta(days=33)).date().isoformat()

        response = client.get(
            "/api/dashboard",
            params={"start_date": start, "end_date": end},
        )
        assert response.status_code == 200

        return_ids = {r["id"] for r in response.json()["upcoming_returns"]}
        assert reservation["id"] in return_ids
    finally:
        force_reservation_status(reservation["id"], "CANCELLED")


def test_dashboard_date_range_rejects_start_after_end():
    response = client.get(
        "/api/dashboard",
        params={"start_date": "2027-01-10", "end_date": "2027-01-01"},
    )

    assert response.status_code == 400


def test_upcoming_pickups_ordered_ascending():
    car = ensure_car_available("SA-008-AA")
    now = datetime.now(timezone.utc)

    earlier = create_reservation(
        car["id"],
        car["current_location"]["id"],
        (now + timedelta(days=20)).isoformat(),
        (now + timedelta(days=22)).isoformat(),
    )

    try:
        later = create_reservation(
            car["id"],
            car["current_location"]["id"],
            (now + timedelta(days=25)).isoformat(),
            (now + timedelta(days=27)).isoformat(),
        )

        try:
            response = client.get("/api/dashboard")
            assert response.status_code == 200

            ids_in_order = [
                r["id"] for r in response.json()["upcoming_pickups"]
            ]

            assert earlier["id"] in ids_in_order
            assert later["id"] in ids_in_order
            assert ids_in_order.index(earlier["id"]) < ids_in_order.index(
                later["id"]
            )
        finally:
            force_reservation_status(later["id"], "CANCELLED")
    finally:
        force_reservation_status(earlier["id"], "CANCELLED")
