"""
Request, approve, pay: a booking starts as a request; staff approve it; if an advance
is due the renter is asked for it and the car is held until a deadline; paying (or
staff recording it by hand) confirms it. Nothing is asked when no advance is due.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
import stripe
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import EmailMessage, Invoice, Reservation, ReservationPayment
from app.services.manage_token import create_pay_token
from app.services.public_booking import expire_stale_holds
from tests._dates import far_future_days
from tests.test_email_outbox import _clean_outbox  # noqa: F401  (autouse: empties the outbox)
from tests.test_public_booking import (  # noqa: F401  (fixtures)
    _offer_for,
    _payload,
    _window,
    fake_stripe,
    fresh_limits,
    storefront,
)
from tests.test_reservations import get_location_id

client = TestClient(app)

DEFAULTS = {"online_share_percent": 30, "booking_flow": "INSTANT", "payment_window_hours": 24}


@pytest.fixture
def flow(monkeypatch, storefront, fake_stripe):  # noqa: F811
    """Online booking on, Stripe faked, a booking site to link to; settings put back after."""

    monkeypatch.setenv("STOREFRONT_URL", "https://shop.example.com")

    def configure(**fields):
        response = client.patch("/api/configuration", json=fields)

        assert response.status_code == 200, response.text

    configure(booking_flow="APPROVAL", online_share_percent=30, payment_window_hours=24)

    yield configure

    client.patch("/api/configuration", json=DEFAULTS)


@pytest.fixture
def mail(monkeypatch):
    monkeypatch.setenv("EMAIL_CONNECTION_STRING", "endpoint=https://example.communication.azure.com/;accesskey=fake")
    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "bookings@example.com")


@pytest.fixture
def desk(fake_stripe):  # noqa: F811
    """Cars at Cagliari and staff bookings on them; cancelled and retired afterwards.
    Needs the fake Stripe so that a booking paid in a test can still be cancelled (and
    refunded) while the cars are cleared away."""

    cars: list[str] = []
    reservations: list[str] = []
    slot = {"n": 0}

    def car(price=40):
        response = client.post(
            "/api/admin/cars",
            json={
                "make": "Advance",
                "model": f"M{uuid.uuid4().hex[:4]}",
                "year": 2024,
                "license_plate": f"AP-{uuid.uuid4().hex[:6].upper()}",
                "home_location_id": get_location_id("CAG"),
                "price_per_day": price,
                "offered_online": True,
            },
        )

        assert response.status_code == 201, response.text
        cars.append(response.json()["id"])

        return response.json()

    def book(car_id, *, days=5, start=None, email=None):
        slot["n"] += 1
        pickup = start or (
            datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
            + timedelta(days=far_future_days() + slot["n"] * 9)
        )
        response = client.post(
            "/api/reservations",
            json={
                "customer": {
                    "first_name": "Advance",
                    # A different person each time: customers are matched by their details.
                    "last_name": f"Renter{uuid.uuid4().hex[:8]}",
                    "date_of_birth": "1990-01-01",
                    "address": "Test Street 1",
                    "postal_code": "1000AA",
                    "phone_number": "+31600000000",
                    "email": email or f"advance.{uuid.uuid4().hex[:6]}@example.com",
                },
                "pickup_location_id": get_location_id("CAG"),
                "return_location_id": get_location_id("CAG"),
                "pickup_at": pickup.isoformat(),
                "return_at": (pickup + timedelta(days=days)).isoformat(),
                "car_id": car_id,
            },
        )

        assert response.status_code == 201, response.text
        reservations.append(response.json()["id"])

        return response.json()

    yield car, book

    for reservation_id in reservations:
        client.patch(f"/api/reservations/{reservation_id}/cancel")

    for car_id in cars:
        client.post(f"/api/admin/cars/{car_id}/retire")


def _approve(reservation_id, advance="request"):
    return client.post(f"/api/reservations/{reservation_id}/approve", json={"advance": advance})


def _row(reservation_id) -> Reservation:
    db = SessionLocal()
    try:
        row = db.get(Reservation, uuid.UUID(reservation_id))
        db.expunge(row)

        return row
    finally:
        db.close()


def _payment(reservation_id) -> ReservationPayment | None:
    db = SessionLocal()
    try:
        return db.scalar(select(ReservationPayment).where(ReservationPayment.reservation_id == uuid.UUID(reservation_id)))
    finally:
        db.close()


def _bearer(reservation_id):
    row = _row(reservation_id)
    token = create_pay_token(row.id, datetime.now(timezone.utc) + timedelta(days=2))

    return row.public_reference, {"Authorization": f"Bearer {token}"}


def _messages(reservation_id, template=None):
    db = SessionLocal()
    try:
        rows = db.scalars(
            select(EmailMessage).where(EmailMessage.reservation_id == uuid.UUID(reservation_id)).order_by(EmailMessage.created_at)
        ).all()

        return [row for row in rows if template is None or row.template == template]
    finally:
        db.close()


# ---- the setting ------------------------------------------------------------------------------


def test_the_online_share_may_be_zero_and_then_nothing_is_taken_before_pickup(flow):
    from app.services.public_catalog import split_payment

    flow(online_share_percent=0)

    assert client.get("/api/configuration").json()["online_share_percent"] == 0
    assert split_payment(Decimal("120.00"), 0) == (Decimal("0.00"), Decimal("120.00"))


# ---- a request ----------------------------------------------------------------------------------


def test_a_staff_booking_is_a_pending_request_with_a_reference_the_renter_can_use(desk, flow):
    car, book = desk
    reservation = book(car()["id"])

    assert reservation["status"] == "PENDING"
    assert reservation["public_reference"] and len(reservation["public_reference"]) == 9


def test_the_renter_is_told_the_request_arrived(desk, flow, mail):
    car, book = desk
    reservation = book(car()["id"])

    [message] = _messages(reservation["id"], "request_received")

    assert reservation["public_reference"] in message.body_text
    assert "not confirmed yet" in message.body_text


# ---- approving -----------------------------------------------------------------------------------


def test_approving_asks_for_the_advance_and_holds_the_car(desk, flow):
    car, book = desk
    first_car = car(40)
    reservation = book(first_car["id"], days=5)
    # A second request for the same car and dates: pending requests never block each other.
    rival = book(first_car["id"], days=5, start=_row(reservation["id"]).pickup_at)

    approved = _approve(reservation["id"])

    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["status"] == "AWAITING_PAYMENT"
    assert Decimal(str(body["agreed_total_amount"])) == Decimal("200.00")
    assert body["prepayment_percent"] == 30

    row = _row(reservation["id"])
    assert row.advance_amount == Decimal("60.00")
    assert row.cancellation_deadline_at is not None
    assert row.hold_expires_at is not None
    assert timedelta(hours=23) < row.hold_expires_at - datetime.now(timezone.utc) <= timedelta(hours=24)

    # The car is held while the advance is awaited: the rival request cannot be approved.
    refused = _approve(rival["id"], "none")

    assert refused.status_code == 400
    assert refused.json()["code"] == "reservation.cannot_confirm_car_already_reserved"


def test_approving_without_an_advance_confirms_at_once(desk, flow):
    car, book = desk
    reservation = book(car()["id"])

    approved = _approve(reservation["id"], "none")

    assert approved.status_code == 200
    assert approved.json()["status"] == "CONFIRMED"
    assert _row(reservation["id"]).advance_amount is None


def test_with_a_zero_share_approving_confirms_at_once(desk, flow):
    flow(online_share_percent=0)
    car, book = desk
    reservation = book(car()["id"])

    assert _approve(reservation["id"]).json()["status"] == "CONFIRMED"


def test_where_online_payment_is_not_set_up_the_advance_is_asked_for_and_recorded_by_hand(desk, flow, monkeypatch):
    monkeypatch.setattr(stripe, "api_key", None)
    car, book = desk
    reservation = book(car()["id"])

    approved = _approve(reservation["id"])

    # Still held and waiting; there is just no card form to send the renter to.
    assert approved.status_code == 200
    assert approved.json()["status"] == "AWAITING_PAYMENT"
    assert _row(reservation["id"]).advance_amount == Decimal("60.00")

    refused = client.post(
        f"/api/public/bookings/{reservation['public_reference']}/payment",
        json={"terms_accepted": True, "privacy_acknowledged": True},
        headers=_bearer(reservation["id"])[1],
    )
    assert refused.status_code == 503

    received = client.post(f"/api/reservations/{reservation['id']}/advance-received", json={"method": "TRANSFER"})

    assert received.status_code == 200
    assert received.json()["status"] == "CONFIRMED"


def test_the_advance_is_not_asked_when_pickup_is_too_close(desk, flow):
    car, book = desk
    soon = datetime.now(timezone.utc) + timedelta(minutes=90)
    reservation = book(car()["id"], start=soon)

    refused = _approve(reservation["id"])

    assert refused.status_code == 400
    assert refused.json()["code"] == "reservation.advance_too_late"


def test_only_a_pending_request_can_be_approved(desk, flow):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"], "none")

    again = _approve(reservation["id"])

    assert again.status_code == 400
    assert again.json()["code"] == "reservation.cannot_change_status"


def test_approving_sends_the_payment_request_with_a_link_and_the_deadline(desk, flow, mail):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"])

    [message] = _messages(reservation["id"], "payment_requested")

    assert "60.00" in message.body_text
    assert "https://shop.example.com/en/booking/" in message.body_text.replace("/it/", "/en/").replace("/pl/", "/en/")
    assert "#pay=" in message.body_text


# ---- paying --------------------------------------------------------------------------------------


def test_paying_the_advance_confirms_the_booking_and_issues_its_invoice(desk, flow, fake_stripe, mail):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"])
    reference, headers = _bearer(reservation["id"])

    started = client.post(
        f"/api/public/bookings/{reference}/payment",
        json={"terms_accepted": True, "privacy_acknowledged": True},
        headers=headers,
    )

    assert started.status_code == 200, started.text
    assert started.json()["amount"] == 60.0
    [intent] = [i for i in fake_stripe.intents.values() if i.amount == 6000]

    # The card is charged; the browser then asks us to check.
    intent.status = "succeeded"
    synced = client.post(f"/api/public/bookings/{reference}/sync-payment", headers=headers)

    assert synced.status_code == 200, synced.text
    assert synced.json()["status"] == "CONFIRMED"
    assert _payment(reservation["id"]).payment_status == "SUCCEEDED"

    db = SessionLocal()
    try:
        invoices = db.scalars(select(Invoice).where(Invoice.reservation_id == uuid.UUID(reservation["id"]))).all()

        assert len(invoices) == 1
    finally:
        db.close()

    assert _messages(reservation["id"], "booking_confirmed")
    assert _messages(reservation["id"], "receipt")


def test_a_booking_staff_made_needs_the_terms_accepted_before_paying(desk, flow):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"])
    reference, headers = _bearer(reservation["id"])

    refused = client.post(f"/api/public/bookings/{reference}/payment", json={}, headers=headers)

    assert refused.status_code == 400
    assert refused.json()["code"] == "public.terms_required"


def test_nothing_can_be_paid_before_the_booking_is_approved(desk, flow):
    car, book = desk
    reservation = book(car()["id"])
    reference, headers = _bearer(reservation["id"])

    refused = client.post(
        f"/api/public/bookings/{reference}/payment",
        json={"terms_accepted": True, "privacy_acknowledged": True},
        headers=headers,
    )

    assert refused.status_code == 409
    assert refused.json()["code"] == "public.payment_not_open"


def test_a_payment_link_cannot_cancel_the_booking(desk, flow):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"])
    reference, headers = _bearer(reservation["id"])

    refused = client.post(f"/api/public/bookings/{reference}/cancel", headers=headers)

    assert refused.status_code == 401
    assert _row(reservation["id"]).status == "AWAITING_PAYMENT"

    # But it can look at the booking, and sees that a payment is open.
    view = client.get(f"/api/public/bookings/{reference}", headers=headers)

    assert view.status_code == 200
    assert view.json()["payment_open"] is True and view.json()["advance_amount"] == 60.0
    assert view.json()["terms_accepted"] is False


def test_the_lookup_with_reference_and_email_finds_a_booking_staff_made(desk, flow):
    car, book = desk
    reservation = book(car()["id"], email="renter.lookup@example.com")

    found = client.post(
        "/api/public/bookings/lookup",
        json={"reference": reservation["public_reference"], "email": "renter.lookup@example.com", "captcha_token": "ok"},
    )

    assert found.status_code == 200, found.text
    assert found.json()["booking"]["reference"] == reservation["public_reference"]


# ---- the window runs out ----------------------------------------------------------------------


def _lapse(reservation_id):
    db = SessionLocal()
    try:
        row = db.get(Reservation, uuid.UUID(reservation_id))
        row.hold_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
        expire_stale_holds(db)
    finally:
        db.close()


def test_an_unpaid_advance_lapses_and_the_renter_is_told(desk, flow, mail):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"])

    _lapse(reservation["id"])

    assert _row(reservation["id"]).status == "EXPIRED"
    assert len(_messages(reservation["id"], "payment_expired")) == 1


def test_staff_can_give_more_time_and_bring_a_lapsed_booking_back(desk, flow):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"])
    _lapse(reservation["id"])

    reopened = client.post(f"/api/reservations/{reservation['id']}/payment-request/extend", json={"hours": 48})

    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "AWAITING_PAYMENT"
    assert _row(reservation["id"]).hold_expires_at > datetime.now(timezone.utc) + timedelta(hours=40)


def test_staff_can_send_the_payment_request_again_and_read_out_the_link(desk, flow, mail):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"])

    resent = client.post(f"/api/reservations/{reservation['id']}/payment-request/resend")

    assert resent.status_code == 200
    assert len(_messages(reservation["id"], "payment_requested")) == 2

    link = client.get(f"/api/reservations/{reservation['id']}/payment-link")

    assert link.status_code == 200
    assert "#pay=" in link.json()["url"]


# ---- recorded by hand -------------------------------------------------------------------------


def test_an_advance_handed_over_by_hand_confirms_the_booking(desk, flow):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"])

    received = client.post(f"/api/reservations/{reservation['id']}/advance-received", json={"method": "CASH"})

    assert received.status_code == 200, received.text
    assert received.json()["status"] == "CONFIRMED"

    payment = _payment(reservation["id"])
    assert payment.payment_status == "SUCCEEDED" and payment.payment_method == "CASH"
    assert payment.payment_amount == Decimal("60.00")


def test_a_manual_advance_is_given_back_without_calling_stripe(desk, flow, fake_stripe):
    car, book = desk
    reservation = book(car()["id"])
    _approve(reservation["id"])
    client.post(f"/api/reservations/{reservation['id']}/advance-received", json={"method": "TRANSFER"})

    cancelled = client.patch(f"/api/reservations/{reservation['id']}/cancel", json={"refund_prepayment": True})

    assert cancelled.status_code == 200, cancelled.text
    assert _payment(reservation["id"]).payment_status == "REFUNDED"
    assert fake_stripe.refunds == []


def test_the_advance_cannot_be_recorded_before_approval(desk, flow):
    car, book = desk
    reservation = book(car()["id"])

    refused = client.post(f"/api/reservations/{reservation['id']}/advance-received", json={"method": "CASH"})

    assert refused.status_code == 400
    assert refused.json()["code"] == "reservation.cannot_change_status"


# ---- the website, in the approval flow ----------------------------------------------------------------


def test_a_request_from_the_website_is_pending_with_nothing_paid_or_held(flow, fake_stripe, mail):
    car_location = get_location_id("CAG")
    pickup, dropoff = _window()
    offer = _offer_for(car_location, pickup, dropoff)

    created = client.post(
        "/api/public/bookings",
        json=_payload(offer, car_location, pickup, dropoff, email=f"req-{uuid.uuid4().hex[:6]}@example.com"),
        headers={"X-Forwarded-For": f"198.51.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250 + 1}"},
    )

    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "PENDING"
    assert body["client_secret"] is None and body["requires_payment"] is False
    assert body["hold_expires_at"] is None
    assert fake_stripe.intents == {}

    row = client.get("/api/reservations", params={"q": body["reference"]}).json()["items"][0]

    assert row["status"] == "PENDING" and row["source"] == "STOREFRONT"
    assert _messages(row["id"], "request_received")

    client.patch(f"/api/reservations/{row['id']}/cancel")


def test_a_website_request_can_be_approved_and_paid_like_any_other(flow, fake_stripe):
    car_location = get_location_id("CAG")
    pickup, dropoff = _window()
    offer = _offer_for(car_location, pickup, dropoff)

    created = client.post(
        "/api/public/bookings",
        json=_payload(offer, car_location, pickup, dropoff, email=f"req-{uuid.uuid4().hex[:6]}@example.com"),
        headers={"X-Forwarded-For": f"198.52.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250 + 1}"},
    )
    reference = created.json()["reference"]
    row = client.get("/api/reservations", params={"q": reference}).json()["items"][0]

    try:
        assert _approve(row["id"]).json()["status"] == "AWAITING_PAYMENT"

        _ref, headers = _bearer(row["id"])
        started = client.post(
            f"/api/public/bookings/{reference}/payment",
            json={"terms_accepted": True, "privacy_acknowledged": True},
            headers=headers,
        )

        assert started.status_code == 200, started.text

        # The renter accepted the terms when they made the request: nothing further to accept.
        view = client.get(f"/api/public/bookings/{reference}", headers=headers).json()

        assert view["terms_accepted"] is True
    finally:
        client.patch(f"/api/reservations/{row['id']}/cancel")
