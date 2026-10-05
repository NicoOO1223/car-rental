"""
Alerts to the business: who receives them, and the three situations that send them.
Azure is a fake sender; nothing leaves the machine.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import EmailMessage, EmailSettings
from tests.test_email_outbox import FakeSender, _booking, _clean_outbox, _flush, _messages, email_on  # noqa: F401
from tests.test_public_booking import (  # noqa: F401  (fixtures)
    _book,
    _finish,
    _iso,
    _set_reservation,
    _succeed,
    _sync,
    fake_stripe,
    fresh_limits,
    storefront,
)
from tests.test_public_lifecycle import _auth, _paid_booking as _book_and_pay
from tests.test_reservations import confirm_reservation, create_reservation, ensure_car_available

client = TestClient(app)

BOSS = "owner@example.com"
SECOND = "manager@example.com"


_booked: list[str] = []


def _paid_booking(fake_stripe):
    """A paid online booking, cancelled again when the test ends so it does not hold the car."""

    result = _book_and_pay(fake_stripe)
    _booked.append(result[0])

    return result


@pytest.fixture(autouse=True)
def _reset_recipients():
    yield

    while _booked:
        _finish(_booked.pop())

    db = SessionLocal()
    try:
        settings = db.get(EmailSettings, 1)

        if settings is not None:
            settings.alert_recipients = []
            db.commit()
    finally:
        db.close()


def _recipients(*addresses: str):
    response = client.put("/api/email/alert-recipients", json={"recipients": list(addresses)})

    assert response.status_code == 200, response.text

    return response.json()


def _alerts(template: str, to: str | None = None) -> list[EmailMessage]:
    return [m for m in _messages() if m.template == template and (to is None or m.to_address == to)]


# --- the recipients ----------------------------------------------------------------------------


def test_recipients_are_saved_cleaned_and_shown_in_the_status():
    status = _recipients(f" {BOSS} ", "", BOSS.upper(), SECOND)

    assert status["alert_recipients"] == [BOSS, SECOND]
    assert client.get("/api/email/status").json()["alert_recipients"] == [BOSS, SECOND]


def test_a_bad_address_or_too_many_are_refused():
    assert client.put("/api/email/alert-recipients", json={"recipients": ["nope"]}).json()["code"] == "email.address_invalid"

    many = [f"a{i}@example.com" for i in range(6)]
    response = client.put("/api/email/alert-recipients", json={"recipients": many})

    assert response.status_code == 400 and response.json()["code"] == "email.too_many_recipients"


def test_recipients_can_be_emptied():
    _recipients(BOSS)

    assert _recipients()["alert_recipients"] == []


# --- the alerts --------------------------------------------------------------------------------


def test_nothing_is_sent_when_no_one_is_listed(email_on, storefront, fake_stripe):
    _paid_booking(fake_stripe)

    assert _alerts("new_online_booking") == []


def test_a_paid_online_booking_alerts_every_recipient_once_without_a_renter_footer(email_on, storefront, fake_stripe):
    _recipients(BOSS, SECOND)
    reference, token, offer = _paid_booking(fake_stripe)

    # Syncing again (the browser, the webhook and the sweeper all do) must not repeat it.
    _sync(reference, token)

    assert len(_alerts("new_online_booking", BOSS)) == 1
    assert len(_alerts("new_online_booking", SECOND)) == 1

    message = _alerts("new_online_booking", BOSS)[0]

    assert reference in message.body_text
    assert message.reply_to is None
    assert "-- " not in message.body_text  # the legal footer is for renters

    sender = FakeSender()
    _flush(sender)

    assert {to for template, to, _ in sender.sent if template == "new_online_booking"} == {BOSS, SECOND}


def test_a_switched_off_alert_is_not_queued(email_on, storefront, fake_stripe):
    _recipients(BOSS)
    assert client.patch("/api/email/types/new_online_booking", json={"enabled": False}).status_code == 200

    try:
        _paid_booking(fake_stripe)

        assert _alerts("new_online_booking") == []
    finally:
        client.patch("/api/email/types/new_online_booking", json={"enabled": True})


def test_an_online_cancellation_alerts_with_what_happened_to_the_money(email_on, storefront, fake_stripe):
    _recipients(BOSS)
    reference, token, offer = _paid_booking(fake_stripe)

    assert client.post(f"/api/public/bookings/{reference}/cancel", headers=_auth(token)).status_code == 200

    [message] = _alerts("online_cancellation", BOSS)

    assert reference in message.subject
    assert "refunded" in message.body_text


def test_a_cancellation_by_staff_does_not_alert_the_business(email_on):
    _recipients(BOSS)
    reservation = _booking()

    client.patch(f"/api/reservations/{reservation['id']}/cancel")

    assert _alerts("online_cancellation") == []


def test_a_late_payment_that_had_to_be_refunded_needs_attention(email_on, storefront, fake_stripe):
    _recipients(BOSS)
    response, offer, (location_id, pickup, dropoff) = _book()
    reference = response.json()["reference"]
    other = None

    try:
        _set_reservation(reference, status="EXPIRED", hold_expires_at=datetime.now(timezone.utc) - timedelta(minutes=5))
        car = ensure_car_available("SA-005-AA")
        other = create_reservation(car["id"], location_id, _iso(pickup), _iso(dropoff))
        confirm_reservation(other["id"])

        _succeed(fake_stripe, reference)
        _sync(reference, response.json()["manage_token"])

        [message] = _alerts("needs_attention", BOSS)

        assert message.subject.startswith("Needs attention")
        assert reference in message.body_text
        assert _alerts("new_online_booking") == []
    finally:
        _finish(reference)

        if other:
            client.patch(f"/api/reservations/{other['id']}/cancel")


def test_an_email_that_is_given_up_on_alerts_the_business_but_a_failed_alert_does_not_loop(email_on):
    from app.models.email_message import MAX_ATTEMPTS

    _recipients(BOSS)
    reservation = _booking()

    try:
        sender = FakeSender(fail_times=10_000)
        now = datetime.now(timezone.utc)

        for attempt in range(MAX_ATTEMPTS + 1):
            _flush(sender, now=now + timedelta(days=attempt))

        messages = _messages()
        failed = [m for m in messages if m.status == "FAILED"]

        # The renter email gave up; the alert about it was queued, and when that failed too, nothing more.
        assert any(m.template == "booking_confirmed" for m in failed)
        assert len(_alerts("needs_attention", BOSS)) == 1
        assert not [m for m in messages if m.template == "needs_attention" and "needs_attention" in m.body_text]
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_the_alerts_have_a_working_default_in_every_language():
    from app.i18n.email_templates import TEMPLATES
    from app.languages import SUPPORTED_LANGUAGES
    from app.services.email_render import Wording, render
    from app.services.email_types import SAMPLE_VALUES, TYPES

    for key in ("new_online_booking", "online_cancellation", "needs_attention"):
        assert TYPES[key].audience == "business" and key in TEMPLATES

        for language in SUPPORTED_LANGUAGES:
            rendered = render(Wording({}, {}), TYPES[key], language, {"business": "Sample", "contact": "", **SAMPLE_VALUES[key]})

            assert rendered.subject and "{" not in rendered.text
