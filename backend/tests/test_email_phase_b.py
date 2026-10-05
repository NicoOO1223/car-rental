"""
The timed and follow-up emails to renters: booking changed (held and merged), pickup
reminder, agreement copy, return summary and refund notice. Azure is a fake sender.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import EmailMessage, EmailTypeSetting, Reservation
from app.services import email_outbox
from app.services.email_outbox import queue_due_pickup_reminders, run_schedule
from tests._dates import far_future_days
from tests.test_check_outs import cleanup, complete, condition, make_active_reservation, pay_cash, sign
from tests.test_email_outbox import FakeSender, _booking, _clean_outbox, _flush, _messages, email_on  # noqa: F401
from tests.test_handovers import (
    TINY_SIGNATURE,
    _employee_sign,
    _mark_identity_verified,
    _reset_identity_verification,
    create_confirmed_reservation,
    finish_rental,
)

client = TestClient(app)


def _of(reservation_id: str, template: str) -> list[EmailMessage]:
    return [m for m in _messages(reservation_id) if m.template == template]


def _pickup(reservation: dict) -> datetime:
    return datetime.fromisoformat(reservation["pickup_at"].replace("Z", "+00:00"))


def _move_return(reservation: dict, hours: int):
    ret = datetime.fromisoformat(reservation["return_at"].replace("Z", "+00:00")) + timedelta(hours=hours)

    return client.patch(f"/api/reservations/{reservation['id']}", json={"return_at": ret.isoformat()})


def _set_option(type_key: str, **options):
    db = SessionLocal()
    try:
        db.merge(EmailTypeSetting(type=type_key, enabled=True, options=options))
        db.commit()
    finally:
        db.close()


# --- booking changed ---------------------------------------------------------------------------


def test_changing_the_dates_queues_one_held_email_listing_what_changed(email_on):
    reservation = _booking()

    try:
        assert _move_return(reservation, 3).status_code == 200

        [message] = _of(reservation["id"], "booking_changed")

        assert message.status == "PENDING"
        assert "->" in message.body_text and "Return time" in message.body_text
        assert "Pick-up time" not in message.body_text.split("Your booking now stands")[0]
        # Held for about five minutes.
        wait = message.next_attempt_at - datetime.now(timezone.utc)
        assert timedelta(minutes=4) < wait <= timedelta(minutes=5)

        # Not sent while held; the confirmation goes out as usual.
        sender = FakeSender()
        _flush(sender)
        assert [item[0] for item in sender.sent] == ["booking_confirmed"]

        # Once the hold has passed it is sent.
        sender = FakeSender()
        _flush(sender, now=datetime.now(timezone.utc) + timedelta(minutes=6))
        assert [item[0] for item in sender.sent] == ["booking_changed"]
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_several_quick_edits_are_one_email_comparing_with_the_original(email_on):
    reservation = _booking()

    try:
        _move_return(reservation, 3)
        _move_return({**reservation, "return_at": _shifted(reservation, 3)}, 2)

        [message] = _of(reservation["id"], "booking_changed")

        assert message.context["before"]["return_time"].startswith(reservation["return_at"][:13])
        # One line for the return time: from the original to where it ended up.
        assert message.body_text.count("Return time:") == 1
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def _shifted(reservation: dict, hours: int) -> str:
    ret = datetime.fromisoformat(reservation["return_at"].replace("Z", "+00:00")) + timedelta(hours=hours)

    return ret.isoformat()


def test_changing_it_back_cancels_the_pending_email(email_on):
    reservation = _booking()

    try:
        _move_return(reservation, 3)
        assert len(_of(reservation["id"], "booking_changed")) == 1

        _move_return({**reservation, "return_at": _shifted(reservation, 3)}, -3)

        assert _of(reservation["id"], "booking_changed") == []
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_editing_only_the_customer_or_an_unconfirmed_request_sends_nothing(email_on):
    reservation = _booking()

    try:
        edit = client.patch(
            f"/api/reservations/{reservation['id']}",
            json={"customer": {"phone_number": f"+3165{uuid4().int % 10**7:07d}"}},
        )
        assert edit.status_code == 200
        assert _of(reservation["id"], "booking_changed") == []
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- pickup reminder ---------------------------------------------------------------------------


def test_a_reminder_goes_out_once_pickup_is_inside_the_window(email_on):
    reservation = _booking()
    pickup = _pickup(reservation)

    try:
        db = SessionLocal()
        try:
            # Too early: pickup is still far away.
            queue_due_pickup_reminders(db, pickup - timedelta(hours=48))
            assert _of(reservation["id"], "pickup_reminder") == []

            queue_due_pickup_reminders(db, pickup - timedelta(hours=10))
            queue_due_pickup_reminders(db, pickup - timedelta(hours=9))
        finally:
            db.close()

        [message] = _of(reservation["id"], "pickup_reminder")

        assert message.status == "PENDING"
        assert message.language == "en"
        assert "pick" in message.body_text.lower()
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_the_reminder_time_is_the_one_an_administrator_set(email_on):
    reservation = _booking()
    pickup = _pickup(reservation)
    _set_option("pickup_reminder", hours_before=48)

    try:
        db = SessionLocal()
        try:
            queue_due_pickup_reminders(db, pickup - timedelta(hours=30))
        finally:
            db.close()

        assert len(_of(reservation["id"], "pickup_reminder")) == 1
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_no_reminder_for_a_cancelled_booking_a_late_booking_or_a_past_pickup(email_on):
    cancelled = _booking()
    client.patch(f"/api/reservations/{cancelled['id']}/cancel")

    late = _booking(far_future_days() + 5)
    past = _booking(far_future_days() + 9)

    try:
        db = SessionLocal()
        try:
            # Booked only 5 hours before its pickup: the renter was just told.
            row = db.get(Reservation, UUID(late["id"]))
            row.created_at = _pickup(late) - timedelta(hours=5)
            db.commit()

            queue_due_pickup_reminders(db, _pickup(cancelled) - timedelta(hours=10))
            queue_due_pickup_reminders(db, _pickup(late) - timedelta(hours=3))
            queue_due_pickup_reminders(db, _pickup(past) + timedelta(hours=1))
        finally:
            db.close()

        assert _of(cancelled["id"], "pickup_reminder") == []
        assert _of(late["id"], "pickup_reminder") == []
        assert _of(past["id"], "pickup_reminder") == []
    finally:
        client.patch(f"/api/reservations/{late['id']}/cancel")
        client.patch(f"/api/reservations/{past['id']}/cancel")


def test_the_schedule_does_nothing_while_another_replica_holds_the_lock(email_on):
    reservation = _booking()
    pickup = _pickup(reservation)

    try:
        other = SessionLocal()
        try:
            from sqlalchemy import text

            other.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": email_outbox.SCHEDULE_LOCK})

            db = SessionLocal()
            try:
                assert run_schedule(db, pickup - timedelta(hours=10)) == 0
            finally:
                db.close()
        finally:
            other.rollback()
            other.close()

        assert _of(reservation["id"], "pickup_reminder") == []

        db = SessionLocal()
        try:
            assert run_schedule(db, pickup - timedelta(hours=10)) >= 1
        finally:
            db.close()

        assert len(_of(reservation["id"], "pickup_reminder")) == 1
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_switched_off_reminder_is_not_queued(email_on):
    reservation = _booking()
    db = SessionLocal()
    try:
        db.merge(EmailTypeSetting(type="pickup_reminder", enabled=False, options={}))
        db.commit()
        assert queue_due_pickup_reminders(db, _pickup(reservation) - timedelta(hours=10)) == 0
    finally:
        db.close()
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- agreement copy ----------------------------------------------------------------------------


def test_generating_the_agreement_sends_the_signed_copy_attached(email_on):
    start = datetime.now(timezone.utc) + timedelta(days=far_future_days() + 20)
    reservation = create_confirmed_reservation(
        "SA-008-AA",
        start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (start + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )

    try:
        assert client.post(f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment").status_code == 200
        assert (
            client.post(
                f"/api/reservations/{reservation['id']}/handover/signature", json={"signature_image": TINY_SIGNATURE}
            ).status_code
            == 200
        )
        _employee_sign(reservation["id"])
        _mark_identity_verified(reservation["customer"]["id"])

        assert client.post(f"/api/reservations/{reservation['id']}/handover/agreement").status_code == 200

        [message] = _of(reservation["id"], "agreement_copy")

        assert message.attachment_kind == "agreement"
        assert "attached" in message.body_text

        sender = FakeSender()
        _flush(sender)
        [(_, _, attachment)] = [item for item in sender.sent if item[0] == "agreement_copy"]

        assert attachment[1].startswith(b"%PDF") and attachment[2] == "application/pdf"
    finally:
        finish_rental(reservation["id"])
        _reset_identity_verification(reservation["customer"]["id"])


# --- return summary ----------------------------------------------------------------------------


def test_completing_the_return_sends_a_summary_with_the_charges(email_on):
    reservation, car = make_active_reservation(hours_late=3)

    try:
        assert condition(reservation["id"]).status_code == 200
        assert pay_cash(reservation["id"]).status_code == 200
        assert sign(reservation["id"]).status_code == 200
        assert complete(reservation["id"]).status_code == 200

        [message] = _of(reservation["id"], "return_summary")

        assert message.to_address.startswith("return.")
        assert "Late return fee" in message.body_text
        # No fuel or damage charge, so those lines are gone.
        assert "Fuel fee" not in message.body_text and "Damage charge" not in message.body_text
        assert "Total charged at return" in message.body_text
    finally:
        cleanup(reservation, car)


def test_a_clean_return_says_so_without_empty_charge_lines(email_on):
    reservation, car = make_active_reservation(hours_late=-2)

    try:
        assert condition(reservation["id"]).status_code == 200
        assert sign(reservation["id"]).status_code == 200
        assert complete(reservation["id"]).status_code == 200

        [message] = _of(reservation["id"], "return_summary")

        assert "Late return fee" not in message.body_text
        assert "0.00" in message.body_text
    finally:
        cleanup(reservation, car)


# --- refund notice -----------------------------------------------------------------------------


def test_a_refund_sends_a_notice_with_the_credit_note_attached(email_on):
    reservation = _booking()

    try:
        assert client.post(f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment").status_code == 200
        assert client.patch(f"/api/reservations/{reservation['id']}/cancel").status_code == 200

        [message] = _of(reservation["id"], "refund_notice")

        assert message.attachment_kind == "credit_note" and message.attachment_id is not None
        assert "CN-" in message.body_text

        sender = FakeSender()
        _flush(sender)
        [(_, _, attachment)] = [item for item in sender.sent if item[0] == "refund_notice"]

        assert attachment[0].startswith("CN-") and attachment[1].startswith(b"%PDF")
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_the_refund_notice_does_not_claim_an_attachment_when_that_is_off(email_on):
    _set_option("refund_notice", attach_credit_note=False)
    reservation = _booking()

    try:
        client.post(f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment")
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

        [message] = _of(reservation["id"], "refund_notice")

        assert message.attachment_kind is None
        assert "attached" not in message.body_text
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_every_new_email_has_a_working_default_in_every_language():
    from app.i18n.email_templates import TEMPLATES
    from app.languages import SUPPORTED_LANGUAGES
    from app.services.email_types import SAMPLE_VALUES, TYPES
    from app.services.email_render import Wording, render

    for key in ("booking_changed", "pickup_reminder", "agreement_copy", "return_summary", "refund_notice"):
        assert key in TYPES and key in TEMPLATES

        for language in SUPPORTED_LANGUAGES:
            rendered = render(Wording({}, {}), TYPES[key], language, {"business": "Sample", "contact": "", **SAMPLE_VALUES[key]})

            assert rendered.subject and "{" not in rendered.subject
            assert "{" not in rendered.text
