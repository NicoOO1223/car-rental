"""
Booking from the storefront: a car is held, the online share is paid through
Stripe (faked here), and the booking is confirmed by whichever of the webhook,
the browser's sync call or the sweeper notices first.
"""

import itertools
import random
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest
import stripe
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import Customer, Invoice, Reservation, ReservationPayment
from app.services import public_booking, rate_limit, turnstile
from app.services.availability import has_conflicting_reservation
from app.services.manage_token import create_manage_token
from app.services.auth import decode_access_token
from app.services.public_booking import expire_stale_holds, normalize_reference
from app.services.stripe_sync import handle_event
from tests.test_reservations import create_reservation, ensure_car_available, get_location_id

client = TestClient(app)


# --- a fake Stripe --------------------------------------------------------------------------------


class FakeStripe:
    def __init__(self):
        self.intents = {}
        self.refunds = []
        self.fail_create = False

    def create(self, **kwargs):
        if self.fail_create:
            raise stripe.StripeError("card machine on fire")

        intent = SimpleNamespace(
            id=f"pi_test_{len(self.intents) + 1}_{random.randint(1000, 9999)}",
            client_secret="secret_test",
            status="requires_payment_method",
            amount=kwargs["amount"],
            kwargs=kwargs,
        )
        self.intents[intent.id] = intent

        return intent

    def retrieve(self, intent_id):
        return self.intents[intent_id]

    def cancel(self, intent_id):
        self.intents[intent_id].status = "canceled"

    def refund(self, **kwargs):
        self.refunds.append(kwargs)

        return SimpleNamespace(id=f"re_test_{len(self.refunds)}")


@pytest.fixture
def fake_stripe(monkeypatch):
    fake = FakeStripe()

    monkeypatch.setattr(stripe, "api_key", "sk_test_fake")
    monkeypatch.setattr(stripe.PaymentIntent, "create", staticmethod(fake.create))
    monkeypatch.setattr(stripe.PaymentIntent, "retrieve", staticmethod(fake.retrieve))
    monkeypatch.setattr(stripe.PaymentIntent, "cancel", staticmethod(fake.cancel))
    monkeypatch.setattr(stripe.Refund, "create", staticmethod(fake.refund))

    return fake


@pytest.fixture(autouse=True)
def fresh_limits():
    rate_limit.reset()
    yield
    rate_limit.reset()


@pytest.fixture
def storefront():
    assert client.patch("/api/configuration", json={"storefront_enabled": True}).status_code == 200

    try:
        yield
    finally:
        client.patch("/api/configuration", json={"storefront_enabled": False})


# --- helpers ---------------------------------------------------------------------------------------------


_first_day = random.randint(30, 150)
_slots = itertools.count()


def _window(length=3):
    # A different slot for every booking in a run, so two of them never meet.
    start = _first_day + next(_slots) * 5
    pickup = (datetime.now(timezone.utc) + timedelta(days=start)).replace(hour=10, minute=0, second=0, microsecond=0)

    return pickup, pickup + timedelta(days=length)


def _iso(value):
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def _offer_for(location_id, pickup, dropoff, plate="SA-005-AA"):
    """The offer that SA-005 belongs to."""

    from app.models import Car
    from app.services.public_catalog import offer_key

    db = SessionLocal()
    try:
        car = db.scalar(select(Car).where(Car.license_plate == plate))
        key = offer_key(car)
    finally:
        db.close()

    offers = client.get(
        "/api/public/availability",
        params={"pickup_location_id": location_id, "pickup_at": _iso(pickup), "return_at": _iso(dropoff)},
    ).json()["offers"]

    return next(o for o in offers if o["offer_key"] == key)


def _payload(offer, location_id, pickup, dropoff, email="renter@example.com", **overrides):
    body = {
        "offer_key": offer["offer_key"],
        "pickup_location_id": location_id,
        "return_location_id": location_id,
        "pickup_at": _iso(pickup),
        "return_at": _iso(dropoff),
        "customer": {
            "first_name": "Ada",
            "last_name": "Renter",
            "date_of_birth": "1990-04-02",
            "address": "1 Test Street",
            "postal_code": "07100",
            "phone_number": "+390000000001",
            "email": email,
        },
        "expected_total": offer["total_amount"],
        "terms_accepted": True,
        "privacy_acknowledged": True,
        "captcha_token": "ok",
    }
    body.update(overrides)

    return body


def _book(email="renter@example.com", ip="203.0.113.10", plate="SA-005-AA", **overrides):
    ensure_car_available(plate)
    location_id = get_location_id("CAG")
    pickup, dropoff = _window()
    offer = _offer_for(location_id, pickup, dropoff, plate)
    response = client.post(
        "/api/public/bookings",
        json=_payload(offer, location_id, pickup, dropoff, email, **overrides),
        headers={"X-Forwarded-For": ip},
    )

    return response, offer, (location_id, pickup, dropoff)


def _reservation(reference):
    db = SessionLocal()
    try:
        row = db.scalar(select(Reservation).where(Reservation.public_reference == reference))
        db.expunge(row)

        return row
    finally:
        db.close()


def _payment(reference):
    db = SessionLocal()
    try:
        return db.scalar(
            select(ReservationPayment)
            .join(Reservation, Reservation.id == ReservationPayment.reservation_id)
            .where(Reservation.public_reference == reference)
        )
    finally:
        db.close()


def _set_reservation(reference, **fields):
    db = SessionLocal()
    try:
        row = db.scalar(select(Reservation).where(Reservation.public_reference == reference))
        for key, value in fields.items():
            setattr(row, key, value)
        db.commit()
    finally:
        db.close()


def _finish(reference):
    _set_reservation(reference, status="CANCELLED")


def _succeed(fake, reference):
    fake.intents[_payment(reference).stripe_payment_intent_id].status = "succeeded"


def _sync(reference, token):
    return client.post(
        f"/api/public/bookings/{reference}/sync-payment", headers={"Authorization": f"Bearer {token}"}
    )


# --- creating a booking ---------------------------------------------------------------------------------------


def test_a_booking_holds_the_car_and_starts_a_payment_for_the_online_share(storefront, fake_stripe):
    response, offer, (location_id, pickup, dropoff) = _book()

    assert response.status_code == 201, response.text

    body = response.json()
    reference = body["reference"]

    try:
        assert len(reference) == 9 and reference[4] == "-"
        assert body["status"] == "AWAITING_PAYMENT"
        assert body["client_secret"] == "secret_test"
        assert body["total_amount"] == offer["total_amount"]
        assert body["online_amount"] == offer["online_amount"]
        assert round(body["online_amount"] + body["due_at_pickup"], 2) == body["total_amount"]

        reservation = _reservation(reference)

        assert reservation.source == "STOREFRONT"
        assert reservation.status == "AWAITING_PAYMENT"
        assert float(reservation.agreed_total_amount) == offer["total_amount"]
        assert reservation.prepayment_percent == 30
        assert reservation.hold_expires_at > datetime.now(timezone.utc)
        assert reservation.cancellation_deadline_at == pickup - timedelta(hours=48)
        assert reservation.client_ip_hash and "203.0.113.10" not in reservation.client_ip_hash

        payment = _payment(reference)

        assert payment.payment_status == "PROCESSING"
        assert float(payment.payment_amount) == offer["online_amount"]

        (intent,) = [i for i in fake_stripe.intents.values() if i.id == payment.stripe_payment_intent_id]

        assert intent.amount == round(offer["online_amount"] * 100)
        assert intent.kwargs["receipt_email"] == "renter@example.com"
        assert reference in intent.kwargs["description"]
        assert intent.kwargs["metadata"]["reference"] == reference

        # The car is now held.
        db = SessionLocal()
        try:
            assert has_conflicting_reservation(db, reservation.car_id, pickup, dropoff)
        finally:
            db.close()
    finally:
        _finish(reference)


def test_the_renter_is_always_a_new_customer_with_consent_recorded(storefront, fake_stripe):
    first, *_ = _book(email="same@example.com", ip="203.0.113.21")
    second, *_ = _book(email="same2@example.com", ip="203.0.113.22", plate="SA-005-AA")

    references = [first.json()["reference"], second.json()["reference"]]

    try:
        db = SessionLocal()
        try:
            customers = [
                db.get(Customer, _reservation(reference).customer_id) for reference in references
            ]

            assert customers[0].id != customers[1].id

            for customer in customers:
                assert customer.terms_accepted_at is not None
                assert customer.privacy_acknowledged_at is not None
                assert customer.terms_version == customer.privacy_version >= 1
        finally:
            db.close()
    finally:
        for reference in references:
            _finish(reference)


def test_terms_must_be_accepted(storefront, fake_stripe):
    response, *_ = _book(terms_accepted=False)

    assert response.status_code == 400
    assert response.json()["code"] == "public.terms_required"
    assert not fake_stripe.intents


def test_a_changed_price_holds_nothing(storefront, fake_stripe):
    ensure_car_available("SA-005-AA")
    before = _count_reservations()

    response, *_ = _book(expected_total=1.00)

    assert response.status_code == 409
    assert response.json()["code"] == "public.price_changed"
    assert "new_total" in response.json()["params"]
    assert _count_reservations() == before
    assert not fake_stripe.intents


def _count_reservations():
    db = SessionLocal()
    try:
        return db.scalar(select(func.count(Reservation.id)))
    finally:
        db.close()


def test_a_failed_stripe_call_releases_the_hold(storefront, fake_stripe):
    fake_stripe.fail_create = True

    response, offer, (location_id, pickup, dropoff) = _book()

    assert response.status_code == 400
    assert response.json()["code"] == "stripe.error"

    db = SessionLocal()
    try:
        held = db.scalar(
            select(Reservation).where(
                Reservation.source == "STOREFRONT",
                Reservation.pickup_at == pickup,
            )
        )

        assert held is not None and held.status == "EXPIRED"
    finally:
        db.close()


def test_without_stripe_nothing_is_held(storefront, monkeypatch):
    monkeypatch.setattr(stripe, "api_key", None)
    before = _count_reservations()

    response, *_ = _book()

    assert response.status_code == 503
    assert response.json()["code"] == "stripe.not_configured"
    assert _count_reservations() == before


def test_the_captcha_is_checked_when_it_is_configured(storefront, fake_stripe, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret")
    monkeypatch.setattr(turnstile, "verify_token", lambda token, ip: token == "good")

    refused, *_ = _book(captcha_token="bad")
    assert refused.status_code == 400
    assert refused.json()["code"] == "public.captcha_failed"

    allowed, *_ = _book(captcha_token="good")
    assert allowed.status_code == 201

    _finish(allowed.json()["reference"])


def test_a_production_stack_without_a_captcha_key_refuses_to_book(storefront, fake_stripe, monkeypatch):
    monkeypatch.setattr(turnstile, "IS_PRODUCTION", True)
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)

    response, *_ = _book()

    assert response.status_code == 503
    assert response.json()["code"] == "public.captcha_not_configured"


def test_one_address_can_hold_only_three_cars_at_a_time(storefront, fake_stripe):
    references = []

    try:
        for number in range(3):
            response, *_ = _book(email=f"cap{number}@example.com", ip="203.0.113.50")
            assert response.status_code == 201, response.text
            references.append(response.json()["reference"])

        blocked, *_ = _book(email="cap9@example.com", ip="203.0.113.50")

        assert blocked.status_code == 429
        assert blocked.json()["code"] == "public.too_many_bookings"

        other, *_ = _book(email="cap10@example.com", ip="203.0.113.51")
        assert other.status_code == 201
        references.append(other.json()["reference"])
    finally:
        for reference in references:
            _finish(reference)


def test_one_email_can_hold_only_two_cars_at_a_time(storefront, fake_stripe):
    references = []

    try:
        for number in range(2):
            response, *_ = _book(email="Same.Person@example.com", ip=f"203.0.113.{60 + number}")
            assert response.status_code == 201, response.text
            references.append(response.json()["reference"])

        blocked, *_ = _book(email="same.person@EXAMPLE.com", ip="203.0.113.70")

        assert blocked.status_code == 429
    finally:
        for reference in references:
            _finish(reference)


# --- paying -------------------------------------------------------------------------------------------------------


def test_sync_payment_confirms_the_booking_and_issues_the_advance_invoice(storefront, fake_stripe):
    response, offer, _ = _book()
    reference = response.json()["reference"]
    token = response.json()["manage_token"]

    try:
        # Not paid yet: nothing changes.
        pending = _sync(reference, token)
        assert pending.status_code == 200
        assert pending.json()["status"] == "AWAITING_PAYMENT"

        _succeed(fake_stripe, reference)

        done = _sync(reference, token)

        assert done.json() == {
            "reference": reference,
            "status": "CONFIRMED",
            "hold_expires_at": None,
            "payment_status": "SUCCEEDED",
        }

        again = _sync(reference, token)
        assert again.json()["status"] == "CONFIRMED"

        db = SessionLocal()
        try:
            invoices = list(
                db.scalars(
                    select(Invoice).where(Invoice.payment_id == _payment(reference).id)
                )
            )

            assert len(invoices) == 1
            assert invoices[0].kind == "INVOICE"
            assert invoices[0].handover_id is None
            assert float(invoices[0].total_amount) == offer["online_amount"]
            assert invoices[0].lines[0]["key"] == "line.advance"
        finally:
            db.close()
    finally:
        _finish(reference)


def test_the_webhook_confirms_the_booking_without_the_browser(storefront, fake_stripe):
    response, *_ = _book()
    reference = response.json()["reference"]

    try:
        payment = _payment(reference)
        _succeed(fake_stripe, reference)

        event = {
            "id": f"evt_test_{random.randint(10**6, 10**7)}",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": payment.stripe_payment_intent_id, "status": "succeeded"}},
        }

        db = SessionLocal()
        try:
            assert handle_event(db, event) == "applied"
        finally:
            db.close()

        assert _reservation(reference).status == "CONFIRMED"

        # The same event again, and the browser too: nothing changes.
        db = SessionLocal()
        try:
            assert handle_event(db, event) == "duplicate"
        finally:
            db.close()

        assert _sync(reference, response.json()["manage_token"]).json()["status"] == "CONFIRMED"
    finally:
        _finish(reference)


def test_a_token_only_works_for_its_own_booking(storefront, fake_stripe):
    first, *_ = _book(email="a@example.com", ip="203.0.113.81")
    second, *_ = _book(email="b@example.com", ip="203.0.113.82")

    try:
        crossed = _sync(first.json()["reference"], second.json()["manage_token"])
        assert crossed.status_code == 401
        assert crossed.json()["code"] == "public.manage_token_invalid"

        assert _sync(first.json()["reference"], "not-a-token").status_code == 401
        assert client.post(f"/api/public/bookings/{first.json()['reference']}/sync-payment").status_code == 401

        # Typed sloppily, it is still the same reference.
        loose = first.json()["reference"].lower().replace("-", " ")
        assert _sync(loose, first.json()["manage_token"]).status_code == 200
    finally:
        _finish(first.json()["reference"])
        _finish(second.json()["reference"])


def test_booking_tokens_and_staff_tokens_are_not_interchangeable():
    token = create_manage_token(UUID(int=1))

    with pytest.raises(Exception):
        decode_access_token(token)


# --- holds run out ------------------------------------------------------------------------------------------------------


def test_an_unpaid_hold_expires_and_frees_the_car(storefront, fake_stripe):
    response, offer, (location_id, pickup, dropoff) = _book()
    reference = response.json()["reference"]

    try:
        _set_reservation(reference, hold_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))

        db = SessionLocal()
        try:
            car_id = _reservation(reference).car_id

            # Already free, before the sweeper has run.
            assert not has_conflicting_reservation(db, car_id, pickup, dropoff)

            result = expire_stale_holds(db)
        finally:
            db.close()

        assert result["expired"] >= 1
        assert _reservation(reference).status == "EXPIRED"

        payment = _payment(reference)

        assert payment.payment_status == "CANCELLED"
        assert fake_stripe.intents[payment.stripe_payment_intent_id].status == "canceled"

        # Expired bookings cannot be paid or edited by staff any more.
        assert client.patch(f"/api/reservations/{_reservation(reference).id}", json={}).status_code == 400
    finally:
        _finish(reference)


def test_the_sweeper_honours_a_payment_the_webhook_missed(storefront, fake_stripe):
    response, *_ = _book()
    reference = response.json()["reference"]

    try:
        _succeed(fake_stripe, reference)
        _set_reservation(reference, hold_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))

        db = SessionLocal()
        try:
            result = expire_stale_holds(db)
        finally:
            db.close()

        assert result["confirmed"] >= 1
        assert _reservation(reference).status == "CONFIRMED"
    finally:
        _finish(reference)


def test_a_payment_after_the_hold_ran_out_still_confirms_when_the_car_is_free(storefront, fake_stripe):
    response, *_ = _book()
    reference = response.json()["reference"]

    try:
        _set_reservation(reference, status="EXPIRED", hold_expires_at=datetime.now(timezone.utc) - timedelta(minutes=5))
        _succeed(fake_stripe, reference)

        assert _sync(reference, response.json()["manage_token"]).json()["status"] == "CONFIRMED"
        assert not fake_stripe.refunds
    finally:
        _finish(reference)


def test_a_payment_after_the_car_was_taken_is_refunded(storefront, fake_stripe):
    response, offer, (location_id, pickup, dropoff) = _book()
    reference = response.json()["reference"]
    other = None

    try:
        _set_reservation(reference, status="EXPIRED", hold_expires_at=datetime.now(timezone.utc) - timedelta(minutes=5))

        # Someone else books the same car for the same dates.
        car = ensure_car_available("SA-005-AA")
        other = create_reservation(car["id"], location_id, _iso(pickup), _iso(dropoff))

        _succeed(fake_stripe, reference)

        result = _sync(reference, response.json()["manage_token"])

        assert result.json()["status"] == "EXPIRED"
        assert result.json()["payment_status"] == "REFUNDED"
        assert len(fake_stripe.refunds) == 1
        assert fake_stripe.refunds[0]["payment_intent"] == _payment(reference).stripe_payment_intent_id
    finally:
        _finish(reference)

        if other:
            client.patch(f"/api/reservations/{other['id']}/cancel")


# --- small pieces ------------------------------------------------------------------------------------------------------------


def test_references_are_typed_loosely_and_stored_one_way():
    assert normalize_reference("abcd-2345") == "ABCD-2345"
    assert normalize_reference("abcd 2345") == "ABCD-2345"
    assert normalize_reference(" ABCD2345 ") == "ABCD-2345"
    assert normalize_reference("abc") == "ABC"


def test_new_references_avoid_look_alike_characters():
    for _ in range(200):
        reference = public_booking.new_reference()

        assert not set(reference) & set("01OIL")
        assert normalize_reference(reference) == reference
