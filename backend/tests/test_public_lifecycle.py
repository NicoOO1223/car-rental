"""
After booking: the renter looks their booking up and cancels it, staff cancel
or mark a no-show, and the rest of the rental is taken at the counter with the
online share taken off.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Invoice
from app.services import turnstile
from app.services.dashboard import get_collected_revenue
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
from tests.test_reservations import create_reservation, ensure_car_available

client = TestClient(app)


def _paid_booking(fake_stripe, **kwargs):
    response, offer, window = _book(**kwargs)

    assert response.status_code == 201, response.text

    reference = response.json()["reference"]
    token = response.json()["manage_token"]

    _succeed(fake_stripe, reference)

    assert _sync(reference, token).json()["status"] == "CONFIRMED"

    return reference, token, offer


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _invoices(payment_id):
    db = SessionLocal()
    try:
        return list(db.scalars(select(Invoice).where(Invoice.payment_id == payment_id).order_by(Invoice.sequence)))
    finally:
        db.close()


# --- looking a booking up ------------------------------------------------------------------------------------------


def test_a_renter_finds_their_booking_with_reference_and_email(storefront, fake_stripe):
    reference, token, offer = _paid_booking(fake_stripe, email="finder@example.com")

    try:
        response = client.post(
            "/api/public/bookings/lookup",
            json={"reference": reference.lower(), "email": "Finder@Example.com", "captcha_token": "x"},
        )

        assert response.status_code == 200

        body = response.json()
        view = body["booking"]

        assert view["reference"] == reference
        assert view["status"] == "CONFIRMED"
        assert view["paid_online"] == offer["online_amount"]
        assert view["due_at_pickup"] == offer["due_at_pickup"]
        assert view["can_cancel"] is True
        assert view["cancel_refunds_online"] is True
        assert "license_plate" not in str(view) and "id" not in view

        # The token from the lookup opens the booking again.
        again = client.get(f"/api/public/bookings/{reference}", headers=_auth(body["manage_token"]))
        assert again.status_code == 200 and again.json() == view
    finally:
        _finish(reference)


def test_every_way_of_not_finding_a_booking_looks_the_same(storefront, fake_stripe):
    reference, _, _ = _paid_booking(fake_stripe, email="owner@example.com")
    staff_booking = None

    try:
        car = ensure_car_available("SA-004-AA")
        pickup = datetime.now(timezone.utc) + timedelta(days=200)
        staff_booking = create_reservation(
            car["id"],
            car["current_location"]["id"],
            pickup.strftime("%Y-%m-%dT%H:%M:%SZ"),
            (pickup + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )

        attempts = [
            {"reference": reference, "email": "someone.else@example.com"},
            {"reference": "ZZZZ-9999", "email": "owner@example.com"},
            {"reference": "garbage", "email": "owner@example.com"},
        ]
        answers = [client.post("/api/public/bookings/lookup", json={**a, "captcha_token": "x"}) for a in attempts]

        assert {(r.status_code, r.json()["code"], r.json()["detail"]) for r in answers} == {
            (404, "public.booking_not_found", answers[0].json()["detail"])
        }
    finally:
        _finish(reference)

        if staff_booking:
            client.patch(f"/api/reservations/{staff_booking['id']}/cancel")


def test_the_lookup_needs_the_captcha_and_is_rate_limited(storefront, fake_stripe, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret")
    monkeypatch.setattr(turnstile, "verify_token", lambda token, ip: token == "good")

    refused = client.post(
        "/api/public/bookings/lookup", json={"reference": "ABCD-2345", "email": "a@b.co", "captcha_token": "bad"}
    )
    assert refused.json()["code"] == "public.captcha_failed"

    monkeypatch.delenv("TURNSTILE_SECRET_KEY")

    codes = [
        client.post(
            "/api/public/bookings/lookup", json={"reference": "ABCD-2345", "email": "a@b.co"}
        ).status_code
        for _ in range(12)
    ]

    assert codes[-1] == 429 and codes[0] == 404


# --- cancelling ----------------------------------------------------------------------------------------------------------


def test_cancelling_before_the_deadline_refunds_the_online_share_with_a_credit_note(storefront, fake_stripe):
    reference, token, offer = _paid_booking(fake_stripe)
    payment = _payment(reference)

    response = client.post(f"/api/public/bookings/{reference}/cancel", headers=_auth(token))

    assert response.status_code == 200

    view = response.json()

    assert view["status"] == "CANCELLED"
    assert view["can_cancel"] is False
    assert view["refunded_online"] == offer["online_amount"]
    assert view["paid_online"] == 0 and view["due_at_pickup"] == 0

    assert len(fake_stripe.refunds) == 1
    assert fake_stripe.refunds[0]["payment_intent"] == payment.stripe_payment_intent_id
    assert _payment(reference).payment_status == "REFUNDED"

    reservation = _reservation(reference)

    assert reservation.cancellation_reason == "RENTER" and reservation.cancelled_at is not None

    invoice, credit = _invoices(payment.id)

    assert (invoice.kind, credit.kind) == ("INVOICE", "CREDIT_NOTE")
    assert credit.original_invoice_id == invoice.id
    assert credit.total_amount == -invoice.total_amount

    # The car is free again.
    assert client.post(f"/api/public/bookings/{reference}/cancel", headers=_auth(token)).json()["code"] == (
        "public.cannot_cancel"
    )


def test_cancelling_after_the_deadline_keeps_the_online_share(storefront, fake_stripe):
    reference, token, offer = _paid_booking(fake_stripe)

    try:
        _set_reservation(reference, cancellation_deadline_at=datetime.now(timezone.utc) - timedelta(hours=1))

        before = client.get(f"/api/public/bookings/{reference}", headers=_auth(token)).json()
        assert before["cancel_refunds_online"] is False

        view = client.post(f"/api/public/bookings/{reference}/cancel", headers=_auth(token)).json()

        assert view["status"] == "CANCELLED"
        assert view["refunded_online"] == 0
        assert not fake_stripe.refunds
        assert _payment(reference).payment_status == "SUCCEEDED"
        assert [i.kind for i in _invoices(_payment(reference).id)] == ["INVOICE"]
    finally:
        _finish(reference)


def test_cancelling_an_unpaid_booking_closes_the_payment(storefront, fake_stripe):
    response, offer, _ = _book()
    reference, token = response.json()["reference"], response.json()["manage_token"]
    payment = _payment(reference)

    view = client.post(f"/api/public/bookings/{reference}/cancel", headers=_auth(token)).json()

    assert view["status"] == "CANCELLED"
    assert fake_stripe.intents[payment.stripe_payment_intent_id].status == "canceled"
    assert _payment(reference).payment_status == "CANCELLED"
    assert not fake_stripe.refunds


def test_a_payment_that_completed_just_before_cancelling_is_refunded(storefront, fake_stripe):
    response, offer, _ = _book()
    reference, token = response.json()["reference"], response.json()["manage_token"]

    # Stripe took the money but neither the webhook nor the browser told us yet.
    _succeed(fake_stripe, reference)

    view = client.post(f"/api/public/bookings/{reference}/cancel", headers=_auth(token)).json()

    assert view["status"] == "CANCELLED"
    assert view["refunded_online"] == offer["online_amount"]
    assert len(fake_stripe.refunds) == 1


def test_a_booking_that_has_started_cannot_be_cancelled_online(storefront, fake_stripe):
    reference, token, _ = _paid_booking(fake_stripe)

    try:
        _set_reservation(reference, status="ACTIVE")

        response = client.post(f"/api/public/bookings/{reference}/cancel", headers=_auth(token))

        assert response.status_code == 400
        assert response.json()["code"] == "public.cannot_cancel"
    finally:
        _finish(reference)


# --- staff cancel and no-show --------------------------------------------------------------------------------------------


def test_staff_can_refund_or_keep_regardless_of_the_deadline(storefront, fake_stripe):
    kept, *_ = _paid_booking(fake_stripe, email="k@example.com", ip="203.0.113.91")
    refunded, *_ = _paid_booking(fake_stripe, email="r@example.com", ip="203.0.113.92")

    for reference in (kept, refunded):
        _set_reservation(reference, cancellation_deadline_at=datetime.now(timezone.utc) - timedelta(hours=1))

    def cancel(reference, body=None):
        return client.patch(f"/api/reservations/{_reservation(reference).id}/cancel", json=body)

    # Following the policy: after the deadline, kept.
    assert cancel(kept).status_code == 200
    assert _payment(kept).payment_status == "SUCCEEDED"

    # Staff override it for this one.
    assert cancel(refunded, {"refund_prepayment": True}).status_code == 200
    assert _payment(refunded).payment_status == "REFUNDED"
    assert _reservation(refunded).cancellation_reason == "STAFF"


def test_the_status_route_cancels_the_same_way(storefront, fake_stripe):
    reference, *_ = _paid_booking(fake_stripe)

    response = client.patch(f"/api/reservations/{_reservation(reference).id}/status", json={"status": "CANCELLED"})

    assert response.status_code == 200
    assert _payment(reference).payment_status == "REFUNDED"


def test_a_no_show_keeps_the_online_share_even_before_the_deadline(storefront, fake_stripe):
    reference, *_ = _paid_booking(fake_stripe)
    reservation_id = _reservation(reference).id

    early = client.post(f"/api/reservations/{reservation_id}/no-show")

    assert early.status_code == 400
    assert early.json()["code"] == "reservation.no_show_too_early"

    _set_reservation(
        reference,
        pickup_at=datetime.now(timezone.utc) - timedelta(hours=3),
        return_at=datetime.now(timezone.utc) + timedelta(days=2),
    )

    response = client.post(f"/api/reservations/{reservation_id}/no-show")

    assert response.status_code == 200
    assert _reservation(reference).status == "CANCELLED"
    assert _reservation(reference).cancellation_reason == "NO_SHOW"
    assert _payment(reference).payment_status == "SUCCEEDED"
    assert not fake_stripe.refunds

    again = client.post(f"/api/reservations/{reservation_id}/no-show")
    assert again.json()["code"] == "reservation.no_show_needs_confirmed"


# --- the rest at the counter -----------------------------------------------------------------------------------------------


def test_the_counter_takes_only_what_is_left_and_the_final_invoice_deducts_the_advance(storefront, fake_stripe):
    reference, token, offer = _paid_booking(fake_stripe)

    try:
        reservation_id = _reservation(reference).id

        response = client.post(f"/api/reservations/{reservation_id}/handover/confirm-cash-payment")

        assert response.status_code == 200
        assert response.json()["payment_amount"] == pytest.approx(offer["due_at_pickup"])

        invoices = client.get(f"/api/reservations/{reservation_id}/invoices").json()
        advance, final = [i for i in invoices if i["kind"] == "INVOICE"]

        assert advance["total_amount"] == offer["online_amount"]
        assert final["total_amount"] == pytest.approx(offer["due_at_pickup"])

        db = SessionLocal()
        try:
            lines = db.get(Invoice, UUID(final["id"])).lines
        finally:
            db.close()

        assert lines[-1]["key"] == "line.advance_deducted"
        assert float(lines[-1]["amount"]) == -offer["online_amount"]
        assert round(sum(float(line["amount"]) for line in lines), 2) == pytest.approx(final["total_amount"])
    finally:
        _finish(reference)


def test_a_rental_paid_in_full_online_is_settled_without_taking_money(storefront, fake_stripe):
    original = client.get("/api/configuration").json()["online_share_percent"]

    assert client.patch("/api/configuration", json={"online_share_percent": 100}).status_code == 200

    try:
        reference, token, offer = _paid_booking(fake_stripe)

        try:
            assert offer["due_at_pickup"] == 0

            reservation_id = _reservation(reference).id
            cash = client.post(f"/api/reservations/{reservation_id}/handover/confirm-cash-payment")

            assert cash.status_code == 400
            assert cash.json()["code"] == "handover.nothing_due"

            card = client.post(f"/api/reservations/{reservation_id}/handover/payment-intent")
            assert card.json()["code"] in ("handover.nothing_due", "stripe.not_configured")

            settled = client.post(f"/api/reservations/{reservation_id}/handover/settle-prepaid")

            assert settled.status_code == 200
            assert settled.json()["payment_method"] == "PREPAID"
            assert settled.json()["payment_status"] == "SUCCEEDED"
            assert settled.json()["payment_amount"] == 0

            # Only the advance invoice exists: nothing was taken at the counter.
            invoices = client.get(f"/api/reservations/{reservation_id}/invoices").json()
            assert [i["kind"] for i in invoices] == ["INVOICE"]
        finally:
            _finish(reference)
    finally:
        client.patch("/api/configuration", json={"online_share_percent": original})


def test_a_part_paid_rental_cannot_be_settled_as_prepaid(storefront, fake_stripe):
    reference, *_ = _paid_booking(fake_stripe)

    try:
        response = client.post(f"/api/reservations/{_reservation(reference).id}/handover/settle-prepaid")

        assert response.status_code == 400
        assert response.json()["code"] == "handover.not_fully_prepaid"
    finally:
        _finish(reference)


# --- money reports -------------------------------------------------------------------------------------------------------------


def _collected_today():
    db = SessionLocal()
    try:
        today = datetime.now(timezone.utc).date()
        # A day either side, so the business's calendar day cannot matter.
        result = get_collected_revenue(db, today - timedelta(days=1), today + timedelta(days=1))

        return result.total_collected, result.card_total, result.total_refunded
    finally:
        db.close()


def test_collected_revenue_includes_the_online_share_and_its_refund(storefront, fake_stripe):
    collected, card, refunded = _collected_today()

    reference, token, offer = _paid_booking(fake_stripe)

    after_collected, after_card, after_refunded = _collected_today()

    assert after_collected == pytest.approx(collected + offer["online_amount"])
    assert after_card == pytest.approx(card + offer["online_amount"])

    client.post(f"/api/public/bookings/{reference}/cancel", headers=_auth(token))

    final_collected, _, final_refunded = _collected_today()

    assert final_collected == pytest.approx(collected)
    assert final_refunded == pytest.approx(refunded + offer["online_amount"])
