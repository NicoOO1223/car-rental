"""
What staff see of an online booking: it is marked as one, can be found and
filtered, its money is summarised at the counter, and it shows up as a
notification until it is picked up.
"""

from fastapi.testclient import TestClient

from app.main import app
from tests.test_public_booking import (  # noqa: F401  (fixtures)
    _book,
    _finish,
    _payment,
    _reservation,
    _set_reservation,
    _succeed,
    _sync,
    fake_stripe,
    fresh_limits,
    storefront,
)
from tests.test_reservations import create_reservation, ensure_car_available, get_location_id

client = TestClient(app)


def _paid(fake_stripe, **kwargs):
    response, offer, window = _book(**kwargs)
    reference = response.json()["reference"]
    _succeed(fake_stripe, reference)
    _sync(reference, response.json()["manage_token"])

    return reference, offer


def test_a_reservation_shows_that_it_was_booked_online_and_what_was_paid(storefront, fake_stripe):
    reference, offer = _paid(fake_stripe)

    try:
        reservation_id = _reservation(reference).id
        body = client.get(f"/api/reservations/{reservation_id}").json()

        assert body["source"] == "STOREFRONT"
        assert body["public_reference"] == reference
        assert body["prepayment_percent"] == 30
        assert body["agreed_total_amount"] == str(offer["total_amount"]) or float(body["agreed_total_amount"]) == offer["total_amount"]
        assert body["prepayment"]["payment_status"] == "SUCCEEDED"
        assert float(body["prepayment"]["amount"]) == offer["online_amount"]
        assert body["cancellation_deadline_at"] is not None
    finally:
        _finish(reference)


def test_a_staff_booking_has_no_online_details():
    car = ensure_car_available("SA-004-AA")
    from datetime import datetime, timedelta, timezone

    pickup = datetime.now(timezone.utc) + timedelta(days=210)
    reservation = create_reservation(
        car["id"],
        car["current_location"]["id"],
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (pickup + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )

    try:
        body = client.get(f"/api/reservations/{reservation['id']}").json()

        assert body["source"] == "STAFF"
        assert body["public_reference"] is None
        assert body["prepayment"] is None
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_online_bookings_can_be_found_by_reference_and_filtered_by_source(storefront, fake_stripe):
    reference, _ = _paid(fake_stripe)

    try:
        found = client.get("/api/reservations", params={"q": reference.lower()}).json()

        assert [item["public_reference"] for item in found["items"]] == [reference]

        online = client.get("/api/reservations", params={"source": "STOREFRONT", "limit": 100}).json()
        staff = client.get("/api/reservations", params={"source": "STAFF", "limit": 100}).json()

        assert reference in {item["public_reference"] for item in online["items"]}
        assert all(item["source"] == "STOREFRONT" for item in online["items"])
        assert all(item["source"] == "STAFF" for item in staff["items"])
    finally:
        _finish(reference)


def test_a_hold_waiting_for_payment_is_listed_but_not_counted_as_work(storefront, fake_stripe):
    before = client.get("/api/reservations/summary").json()

    response, *_ = _book()
    reference = response.json()["reference"]

    try:
        listed = client.get("/api/reservations", params={"status": "AWAITING_PAYMENT", "q": reference}).json()

        assert [item["public_reference"] for item in listed["items"]] == [reference]
        assert client.get("/api/reservations/summary").json()["upcoming"] == before["upcoming"]
    finally:
        _finish(reference)


def test_the_counter_summary_says_what_is_paid_and_what_is_due(storefront, fake_stripe):
    reference, offer = _paid(fake_stripe)

    try:
        reservation_id = _reservation(reference).id
        summary = client.get(f"/api/reservations/{reservation_id}/handover/payment-summary").json()

        assert summary["total_amount"] == offer["total_amount"]
        assert summary["paid_online"] == offer["online_amount"]
        assert summary["amount_due"] == offer["due_at_pickup"]
        assert summary["currency"]
    finally:
        _finish(reference)


def test_a_staff_booking_owes_everything_at_the_counter():
    from datetime import datetime, timedelta, timezone

    car = ensure_car_available("SA-004-AA")
    pickup = datetime.now(timezone.utc) + timedelta(days=215)
    reservation = create_reservation(
        car["id"],
        car["current_location"]["id"],
        pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (pickup + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )

    try:
        client.patch(f"/api/reservations/{reservation['id']}/status", json={"status": "CONFIRMED"})
        summary = client.get(f"/api/reservations/{reservation['id']}/handover/payment-summary").json()

        assert summary["paid_online"] == 0
        assert summary["amount_due"] == summary["total_amount"] > 0
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_new_online_booking_is_a_notification_until_it_is_gone(storefront, fake_stripe):
    reference, _ = _paid(fake_stripe)

    def mine():
        items = client.get("/api/notifications").json()["items"]

        return [i for i in items if i["kind"] == "online_booking" and i["reference"] == reference]

    try:
        [item] = mine()

        assert item["severity"] == "info"
        assert item["reservation_id"] == str(_reservation(reference).id)
        assert item["customer"] == "Ada Renter"
    finally:
        _finish(reference)

    assert mine() == []


def test_a_car_can_be_taken_off_the_storefront(storefront):
    car = ensure_car_available("SA-005-AA")

    try:
        off = client.patch(f"/api/cars/{car['id']}", json={"offered_online": False})

        assert off.status_code == 200
        assert off.json()["offered_online"] is False

        # Leaving it out, or sending nothing, keeps it as it is.
        assert client.patch(f"/api/cars/{car['id']}", json={"mileage": 1000}).json()["offered_online"] is False
        assert client.patch(f"/api/cars/{car['id']}", json={"offered_online": None}).status_code == 200
    finally:
        client.patch(f"/api/cars/{car['id']}", json={"offered_online": True})
