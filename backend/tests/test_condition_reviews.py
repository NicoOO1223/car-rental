from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from tests._dates import far_future_days
from tests.test_handovers import TINY_SIGNATURE
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    force_reservation_status,
)

client = TestClient(app)

# Seeded with zero reservations of its own (see seed.py) — safe to build a
# dedicated completed-rental history on without any other test's data
# changing what "the last 3 completed rentals" means.
PLATE = "SA-010-AA"


def _new_reservation(car_id: str, location_id: str) -> dict:
    start = datetime.now(timezone.utc) + timedelta(days=far_future_days())

    return create_reservation(
        car_id,
        location_id,
        start.isoformat(),
        (start + timedelta(days=2)).isoformat(),
    )


def test_condition_reviews_need_a_signed_in_user():
    from app.dependencies import get_current_user

    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    saved = app.dependency_overrides.pop(get_current_user, None)

    try:
        anon = TestClient(app)
        assert anon.get(f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_IN").status_code == 401
    finally:
        if saved is not None:
            app.dependency_overrides[get_current_user] = saved


def test_tire_condition_round_trips_and_stamps_the_car():
    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    response = client.put(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_IN/tire-condition",
        json={"tire_condition": "WORN"},
    )
    assert response.status_code == 200
    assert response.json()["tire_condition"] == "WORN"
    assert response.json()["kind"] == "CHECK_IN"

    fetched = client.get(f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_IN")
    assert fetched.status_code == 200
    assert fetched.json()["tire_condition"] == "WORN"

    updated_car = client.get(f"/api/cars/{car['id']}").json()
    assert updated_car["tire_condition"] == "WORN"

    client.patch(f"/api/cars/{car['id']}", json={"tire_condition": None})


def test_saving_again_updates_the_same_review_not_a_second_one():
    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    first = client.put(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_OUT/tire-condition",
        json={"tire_condition": "GOOD"},
    ).json()

    second = client.put(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_OUT/tire-condition",
        json={"tire_condition": "NEEDS_REPLACEMENT"},
    ).json()

    assert first["id"] == second["id"]
    assert second["tire_condition"] == "NEEDS_REPLACEMENT"

    client.patch(f"/api/cars/{car['id']}", json={"tire_condition": None})


def test_check_in_and_check_out_reviews_are_independent():
    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    client.put(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_IN/tire-condition",
        json={"tire_condition": "GOOD"},
    )

    check_out_review = client.get(f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_OUT")
    assert check_out_review.status_code == 200
    assert check_out_review.json() is None

    client.patch(f"/api/cars/{car['id']}", json={"tire_condition": None})


def test_invalid_kind_is_rejected():
    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    response = client.put(
        f"/api/reservations/{reservation['id']}/condition-reviews/SIDEWAYS/tire-condition",
        json={"tire_condition": "GOOD"},
    )
    assert response.status_code == 400


def test_invalid_tire_condition_is_rejected():
    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    response = client.put(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_IN/tire-condition",
        json={"tire_condition": "BALD"},
    )
    assert response.status_code == 400


def test_photo_round_trips_through_upload_and_content_endpoints():
    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    response = client.post(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_IN/photos",
        json={"category": "EXTERIOR", "data_url": TINY_SIGNATURE},
    )
    assert response.status_code == 200

    review = response.json()
    assert len(review["photos"]) == 1
    photo = review["photos"][0]
    assert photo["category"] == "EXTERIOR"
    assert photo["content_type"] == "image/png"

    content = client.get(f"/api/condition-photos/{photo['id']}/content")
    assert content.status_code == 200
    assert content.headers["content-type"] == "image/png"
    assert len(content.content) > 0


def test_multiple_photos_accumulate_on_the_same_review():
    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    client.post(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_OUT/photos",
        json={"category": "EXTERIOR", "data_url": TINY_SIGNATURE},
    )
    second = client.post(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_OUT/photos",
        json={"category": "INTERIOR", "data_url": TINY_SIGNATURE},
    )

    assert len(second.json()["photos"]) == 2
    categories = {photo["category"] for photo in second.json()["photos"]}
    assert categories == {"EXTERIOR", "INTERIOR"}


def test_invalid_photo_category_is_rejected():
    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    response = client.post(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_IN/photos",
        json={"category": "ROOF", "data_url": TINY_SIGNATURE},
    )
    assert response.status_code == 400


def test_malformed_photo_data_is_rejected():
    car = ensure_car_available(PLATE)
    reservation = _new_reservation(car["id"], car["current_location"]["id"])

    response = client.post(
        f"/api/reservations/{reservation['id']}/condition-reviews/CHECK_IN/photos",
        json={"category": "EXTERIOR", "data_url": "not-a-data-url"},
    )
    assert response.status_code == 400


def test_photo_not_found_returns_404():
    import uuid

    response = client.get(f"/api/condition-photos/{uuid.uuid4()}/content")
    assert response.status_code == 404


# --- the skipped-review alert --------------------------------------------


def _mine_fleet_condition(plate: str) -> dict:
    cars = client.get("/api/fleet-condition").json()["cars"]
    return next(c for c in cars if c["license_plate"] == plate)


def test_fewer_than_three_completed_rentals_never_flagged():
    car = ensure_car_available(PLATE)
    location_id = car["current_location"]["id"]

    for _ in range(2):
        reservation = _new_reservation(car["id"], location_id)
        force_reservation_status(reservation["id"], "COMPLETED")

    assert _mine_fleet_condition(PLATE)["condition_review_overdue"] is False


def test_three_unreviewed_completed_rentals_are_flagged_overdue():
    car = ensure_car_available(PLATE)
    location_id = car["current_location"]["id"]

    for _ in range(3):
        reservation = _new_reservation(car["id"], location_id)
        force_reservation_status(reservation["id"], "COMPLETED")

    assert _mine_fleet_condition(PLATE)["condition_review_overdue"] is True

    notifications = client.get("/api/notifications").json()["items"]
    mine = [i for i in notifications if i["car"]["license_plate"] == PLATE and i["kind"] == "condition_review_due"]
    assert len(mine) == 1


def test_a_review_on_any_of_the_last_three_clears_the_flag():
    car = ensure_car_available(PLATE)
    location_id = car["current_location"]["id"]

    reservations = []
    for _ in range(3):
        reservation = _new_reservation(car["id"], location_id)
        force_reservation_status(reservation["id"], "COMPLETED")
        reservations.append(reservation)

    assert _mine_fleet_condition(PLATE)["condition_review_overdue"] is True

    # Reviewing the oldest of these three is still enough — it only matters
    # that one of the last three was looked at, not which one.
    client.put(
        f"/api/reservations/{reservations[0]['id']}/condition-reviews/CHECK_OUT/tire-condition",
        json={"tire_condition": "GOOD"},
    )

    assert _mine_fleet_condition(PLATE)["condition_review_overdue"] is False

    notifications = client.get("/api/notifications").json()["items"]
    mine = [i for i in notifications if i["car"]["license_plate"] == PLATE and i["kind"] == "condition_review_due"]
    assert mine == []

    client.patch(f"/api/cars/{car['id']}", json={"tire_condition": None})


def test_only_the_last_three_count_a_fourth_older_review_does_not_help():
    car = ensure_car_available(PLATE)
    location_id = car["current_location"]["id"]

    oldest = _new_reservation(car["id"], location_id)
    force_reservation_status(oldest["id"], "COMPLETED")
    client.put(
        f"/api/reservations/{oldest['id']}/condition-reviews/CHECK_OUT/tire-condition",
        json={"tire_condition": "GOOD"},
    )

    for _ in range(3):
        reservation = _new_reservation(car["id"], location_id)
        force_reservation_status(reservation["id"], "COMPLETED")

    # The reviewed rental is now the 4th-most-recent, outside the window.
    assert _mine_fleet_condition(PLATE)["condition_review_overdue"] is True

    client.patch(f"/api/cars/{car['id']}", json={"tire_condition": None})
