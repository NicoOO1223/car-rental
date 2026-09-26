"""
Guards the storefront depends on: a rental cannot be paid twice, cancelling
through any route gives the money back, a paid booking cannot be moved, two
requests cannot book the same car at once, and the client address used for
limits cannot be forged.
"""

import threading
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog, User
from app.schemas.reservation import CustomerCreate
from app.services.availability import lock_car
from app.services.client_ip import client_ip
from app.services.reservations import create_reservation
from tests._dates import far_future_days
from tests.test_handovers import create_confirmed_reservation
from tests.test_reservations import (
    ensure_car_available,
    get_location_id,
)

client = TestClient(app)


def _window(days=2):
    pickup = datetime.now(timezone.utc) + timedelta(days=far_future_days())

    return pickup, pickup + timedelta(days=days)


def _iso(value):
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def _confirmed():
    pickup, dropoff = _window()

    return create_confirmed_reservation("SA-008-AA", _iso(pickup), _iso(dropoff))


def _cash(reservation):
    return client.post(f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment")


# --- a rental is paid once ---------------------------------------------------------------


def test_cash_cannot_be_taken_on_a_rental_that_is_already_paid():
    reservation = _confirmed()

    try:
        assert _cash(reservation).status_code == 200

        again = _cash(reservation)

        assert again.status_code == 400
        assert again.json()["code"] == "handover.payment_already_taken"
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_card_payment_cannot_be_started_on_a_rental_paid_in_cash():
    reservation = _confirmed()

    try:
        assert _cash(reservation).status_code == 200

        response = client.post(f"/api/reservations/{reservation['id']}/handover/payment-intent")

        # Either Stripe is not set up here, or the rental is paid: never a new intent.
        assert response.status_code == 400
        assert response.json()["code"] in ("handover.payment_already_taken", "stripe.not_configured")
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- cancelling gives the money back ------------------------------------------------------


def test_cancelling_through_the_status_route_refunds_like_the_cancel_route():
    reservation = _confirmed()

    assert _cash(reservation).status_code == 200

    response = client.patch(
        f"/api/reservations/{reservation['id']}/status", json={"status": "CANCELLED"}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"

    handover = client.get(f"/api/reservations/{reservation['id']}/handover").json()

    assert handover["payment_status"] == "REFUNDED"

    invoices = client.get(f"/api/reservations/{reservation['id']}/invoices").json()

    assert {item["kind"] for item in invoices} == {"INVOICE", "CREDIT_NOTE"}


# --- a paid booking stays as booked -------------------------------------------------------


def test_the_car_dates_and_places_cannot_change_once_paid_but_the_customer_can():
    reservation = _confirmed()

    try:
        assert _cash(reservation).status_code == 200

        later = datetime.fromisoformat(reservation["pickup_at"].replace("Z", "+00:00")) + timedelta(days=1)

        moved = client.patch(
            f"/api/reservations/{reservation['id']}",
            json={"pickup_at": later.isoformat(), "return_at": (later + timedelta(days=2)).isoformat()},
        )

        assert moved.status_code == 400
        assert moved.json()["code"] == "reservation.cannot_move_after_payment"

        renamed = client.patch(
            f"/api/reservations/{reservation['id']}",
            json={"customer": {"phone_number": "+390789111111"}},
        )

        assert renamed.status_code == 200
    finally:
        # The test customer is shared with other tests, which expect its phone.
        client.patch(
            f"/api/reservations/{reservation['id']}",
            json={"customer": {"phone_number": "+31600000000"}},
        )
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- the audit trail ------------------------------------------------------------------------


def test_creating_a_reservation_is_audited():
    reservation = _confirmed()

    try:
        db = SessionLocal()
        try:
            entry = (
                db.query(AuditLog)
                .filter(
                    AuditLog.action == "reservation.created",
                    AuditLog.entity_id == UUID(reservation["id"]),
                )
                .one()
            )

            assert entry.details["source"] == "staff"
        finally:
            db.close()
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- two requests, one car -----------------------------------------------------------------


def _customer(label):
    return CustomerCreate(
        first_name="Race",
        last_name=label,
        date_of_birth="1990-01-01",
        address="Race Street 1",
        postal_code="0001",
        phone_number="+390000000000",
        email=f"race.{label}@example.com",
    )


def test_a_second_booking_waits_for_the_first_and_then_sees_it():
    """
    The first request holds the car's lock while it decides. Booking the same
    car from another session has to wait for it, and once the first commits it
    finds the conflict. Without the lock the second would not wait at all, so
    checking that it is still waiting is what proves the lock is there.
    """

    car = ensure_car_available("SA-004-AA")
    car_id = UUID(car["id"])
    location_id = UUID(get_location_id("CAG"))
    pickup, dropoff = _window()

    first = SessionLocal()
    outcome = {}

    def second_booking():
        db = SessionLocal()
        try:
            create_reservation(
                db, _customer("second"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(db)
            )
            outcome["result"] = "booked"
        except Exception as error:  # noqa: BLE001
            outcome["result"] = getattr(error, "code", str(error))
        finally:
            db.close()

    created = None

    try:
        lock_car(first, car_id)

        waiting = threading.Thread(target=second_booking)
        waiting.start()
        waiting.join(timeout=1.0)

        assert waiting.is_alive(), "the second booking did not wait for the car's lock"

        # The first request finishes its booking and lets go.
        created = create_reservation(
            first, _customer("first"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(first)
        )

        waiting.join(timeout=10)

        assert not waiting.is_alive()
        assert outcome["result"] == "reservation.car_already_reserved_part_period"
    finally:
        first.close()

        if created is not None:
            client.patch(f"/api/reservations/{created.id}/cancel")


def _actor(db):
    """A real user row to attribute the booking to. The suite's fake user has
    no row, so any existing user will do."""

    return db.scalars(select(User)).first()


def test_lock_car_can_be_taken_and_released_within_a_transaction():
    car = ensure_car_available("SA-004-AA")
    db = SessionLocal()

    try:
        lock_car(db, UUID(car["id"]))
        db.rollback()
    finally:
        db.close()


# --- the client address ----------------------------------------------------------------------


def _request(forwarded=None, host="10.0.0.9"):
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []

    return Request(
        {
            "type": "http",
            "headers": headers,
            "client": (host, 1234),
            "method": "GET",
            "path": "/",
            "query_string": b"",
        }
    )


def test_the_client_address_is_the_last_forwarded_entry_not_one_the_client_wrote():
    # The client sent "1.1.1.1"; the ingress appended the address it really saw.
    assert client_ip(_request("1.1.1.1, 203.0.113.7")) == "203.0.113.7"
    assert client_ip(_request("203.0.113.7")) == "203.0.113.7"


def test_without_a_forwarded_header_the_connection_address_is_used():
    assert client_ip(_request(None, host="10.0.0.9")) == "10.0.0.9"
