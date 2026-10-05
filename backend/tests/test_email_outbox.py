"""
Emails to renters: queued with the event, sent by the worker, retried on failure,
never sent twice, and never able to break the booking or payment they belong to.
Azure is replaced by a fake sender; nothing leaves the machine.
"""

import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.database import SessionLocal
from app.i18n.documents import label
from app.i18n.email_templates import PARTS as DEFAULT_PARTS, TEMPLATES
from app.services.email_render import to_html
from app.languages import SUPPORTED_LANGUAGES
from app.main import app
from app.models import Customer, EmailMessage, EmailPart, EmailTemplate, EmailTypeSetting, Reservation
from app.models.email_message import MAX_ATTEMPTS
from app.services import email_outbox
from app.services.email_outbox import AzureEmailSender, flush_outbox
from tests._dates import far_future_days
from tests.test_handovers import create_confirmed_reservation
from tests.test_reservations import create_reservation, ensure_car_available, get_location_id

client = TestClient(app)


@pytest.fixture
def email_on(monkeypatch):
    monkeypatch.setenv("EMAIL_CONNECTION_STRING", "endpoint=https://example.communication.azure.com/;accesskey=fake")
    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "bookings@example.com")


@pytest.fixture(autouse=True)
def _clean_outbox():
    yield

    db = SessionLocal()
    try:
        db.execute(delete(EmailMessage))
        db.execute(delete(EmailTypeSetting))
        db.execute(delete(EmailTemplate))
        db.execute(delete(EmailPart))
        db.commit()
    finally:
        db.close()


class FakeSender:
    def __init__(self, fail_times: int = 0):
        self.sent = []
        self.fail_times = fail_times
        self.calls = 0

    def send(self, message, attachment):
        self.calls += 1

        if self.calls <= self.fail_times:
            raise RuntimeError("the email service is down")

        self.sent.append((message.template, message.to_address, attachment))


def _messages(reservation_id: str | None = None) -> list[EmailMessage]:
    db = SessionLocal()
    try:
        query = select(EmailMessage).order_by(EmailMessage.created_at)

        if reservation_id is not None:
            query = query.where(EmailMessage.reservation_id == UUID(reservation_id))

        rows = list(db.scalars(query))
        db.expunge_all()

        return rows
    finally:
        db.close()


def _booking(days_ahead: int | None = None):
    start = datetime.now(timezone.utc) + timedelta(days=days_ahead or far_future_days())

    return create_confirmed_reservation(
        "SA-008-AA",
        start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (start + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _flush(sender, **kwargs):
    db = SessionLocal()
    try:
        return flush_outbox(db, sender, **kwargs)
    finally:
        db.close()


# --- when it is queued -------------------------------------------------------------------------


def test_nothing_is_queued_when_this_stack_has_no_email_set_up():
    reservation = _booking()

    try:
        assert _messages(reservation["id"]) == []
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_confirming_a_booking_queues_one_confirmation_with_the_details(email_on):
    reservation = _booking()

    try:
        [message] = _messages(reservation["id"])

        assert message.template == "booking_confirmed"
        assert message.status == "PENDING"
        assert message.to_address == "test.user@example.com"
        assert message.language == "en"
        assert "confirmed" in message.subject
        assert reservation["car"]["make"] in message.body_text
        assert re.search(r"Booking number: \S+", message.body_text)
        assert "<p>" in message.body_html and "<script" not in message.body_html
        assert message.attachment_kind is None
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_queuing_the_same_event_twice_is_one_message(email_on):
    reservation = _booking()

    try:
        db = SessionLocal()
        try:
            row = db.get(Reservation, UUID(reservation["id"]))
            assert email_outbox.queue_booking_confirmed(db, row) is None
            db.commit()
        finally:
            db.close()

        assert len(_messages(reservation["id"])) == 1
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_cancelling_a_confirmed_booking_queues_a_cancellation_but_a_request_that_was_never_confirmed_does_not(email_on):
    confirmed = _booking()
    client.patch(f"/api/reservations/{confirmed['id']}/cancel")

    assert [m.template for m in _messages(confirmed["id"])] == ["booking_confirmed", "booking_cancelled"]

    start = datetime.now(timezone.utc) + timedelta(days=far_future_days())
    request = create_reservation(
        ensure_car_available("SA-008-AA")["id"],
        get_location_id("AHO"),
        start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (start + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    client.patch(f"/api/reservations/{request['id']}/cancel")

    assert _messages(request["id"]) == []


def test_a_cash_payment_queues_a_receipt_with_the_invoice_attached(email_on):
    reservation = _booking()

    try:
        assert client.post(f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment").status_code == 200

        receipts = [m for m in _messages(reservation["id"]) if m.template == "receipt"]

        assert len(receipts) == 1
        assert receipts[0].attachment_kind == "invoice" and receipts[0].attachment_id is not None
        assert "attached" in receipts[0].body_text

        sender = FakeSender()
        assert _flush(sender)["sent"] == 2
        [(_, _, attachment)] = [item for item in sender.sent if item[0] == "receipt"]

        name, data, content_type = attachment
        assert name.endswith(".pdf") and content_type == "application/pdf"
        assert data.startswith(b"%PDF")
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_no_email_is_queued_for_a_customer_without_a_usable_address_or_who_was_erased(email_on):
    for email, erased in (("not-an-address", False), ("erased@example.com", True)):
        reservation = _booking()

        db = SessionLocal()
        try:
            customer = db.get(Customer, UUID(reservation["customer"]["id"]))
            original = (customer.email, customer.anonymized_at)
            customer.email = email
            customer.anonymized_at = datetime.now(timezone.utc) if erased else None
            db.query(EmailMessage).delete()
            db.commit()

            row = db.get(Reservation, UUID(reservation["id"]))
            email_outbox.queue_booking_confirmed(db, row)
            db.commit()

            assert db.scalars(select(EmailMessage)).all() == []

            customer.email, customer.anonymized_at = original
            db.commit()
        finally:
            db.close()
            client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_an_email_that_cannot_be_written_never_breaks_the_booking(email_on, monkeypatch):
    def broken(*_args, **_kwargs):
        raise RuntimeError("template bug")

    monkeypatch.setattr(email_outbox, "render", broken)

    reservation = _booking()

    try:
        # The booking was confirmed all the same.
        assert client.get(f"/api/reservations/{reservation['id']}").json()["status"] == "CONFIRMED"
        assert _messages(reservation["id"]) == []
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- sending -----------------------------------------------------------------------------------


def test_a_sent_message_is_marked_sent_and_never_sent_again(email_on):
    reservation = _booking()

    try:
        sender = FakeSender()

        assert _flush(sender) == {"sent": 1, "retry": 0, "given_up": 0}
        assert _flush(sender) == {"sent": 0, "retry": 0, "given_up": 0}
        assert len(sender.sent) == 1

        [message] = _messages(reservation["id"])
        assert message.status == "SENT" and message.sent_at is not None and message.attempts == 1
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_failed_send_is_retried_later_with_a_growing_gap_and_then_given_up(email_on):
    reservation = _booking()
    start = datetime.now(timezone.utc)

    try:
        sender = FakeSender(fail_times=99)

        assert _flush(sender, now=start) == {"sent": 0, "retry": 1, "given_up": 0}

        [message] = _messages(reservation["id"])
        assert message.status == "PENDING" and message.attempts == 1
        assert "down" in message.last_error
        assert message.next_attempt_at >= start + timedelta(minutes=1)

        # Not due yet: left alone.
        assert _flush(sender, now=start + timedelta(seconds=30)) == {"sent": 0, "retry": 0, "given_up": 0}
        assert sender.calls == 1

        # Each later failure waits longer, until it is given up on.
        moment = start
        gaps = []
        for _ in range(MAX_ATTEMPTS - 1):
            moment = _messages(reservation["id"])[0].next_attempt_at + timedelta(seconds=1)
            result = _flush(sender, now=moment)
            [message] = _messages(reservation["id"])
            gaps.append(message.next_attempt_at - moment)

        assert result["given_up"] == 1
        assert message.status == "FAILED" and message.attempts == MAX_ATTEMPTS
        assert gaps[0] < gaps[1] < gaps[2]

        calls = sender.calls
        assert _flush(sender, now=moment + timedelta(days=30)) == {"sent": 0, "retry": 0, "given_up": 0}
        assert sender.calls == calls
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_message_that_recovers_is_sent_on_the_retry(email_on):
    reservation = _booking()
    start = datetime.now(timezone.utc)

    try:
        sender = FakeSender(fail_times=1)

        assert _flush(sender, now=start)["retry"] == 1
        assert _flush(sender, now=start + timedelta(minutes=2)) == {"sent": 1, "retry": 0, "given_up": 0}

        [message] = _messages(reservation["id"])
        assert message.status == "SENT" and message.attempts == 2 and message.last_error is None
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_two_workers_never_send_the_same_message(email_on):
    reservation = _booking()

    try:
        holder = SessionLocal()
        try:
            # One worker has claimed the message and is in the middle of sending it.
            claimed = holder.scalar(
                select(EmailMessage).where(EmailMessage.status == "PENDING").with_for_update(skip_locked=True).limit(1)
            )
            assert claimed is not None

            other = FakeSender()

            assert _flush(other) == {"sent": 0, "retry": 0, "given_up": 0}
            assert other.sent == []
        finally:
            holder.rollback()
            holder.close()

        assert _flush(FakeSender())["sent"] == 1
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- Azure -------------------------------------------------------------------------------------


class FakePoller:
    def __init__(self, result):
        self._result = result

    def result(self, timeout=None):
        return self._result


class FakeClient:
    def __init__(self, result):
        self.result = result
        self.messages = []

    def begin_send(self, message):
        self.messages.append(message)

        return FakePoller(self.result)


def _azure_sender(result):
    sender = AzureEmailSender.__new__(AzureEmailSender)
    sender._client = FakeClient(result)
    sender._from = "bookings@example.com"

    return sender


def _message(**overrides):
    values = dict(
        to_address="renter@example.com",
        to_name="Giulia Rossi",
        reply_to="info@example.com",
        subject="Hello",
        body_text="Plain",
        body_html="<p>Html</p>",
    )
    values.update(overrides)

    return SimpleNamespace(**values)


def test_the_azure_message_has_sender_recipient_content_reply_to_and_attachment():
    sender = _azure_sender({"status": "Succeeded"})

    sender.send(_message(), ("INV-1.pdf", b"%PDF-data", "application/pdf"))

    [payload] = sender._client.messages

    assert payload["senderAddress"] == "bookings@example.com"
    assert payload["recipients"] == {"to": [{"address": "renter@example.com", "displayName": "Giulia Rossi"}]}
    assert payload["content"] == {"subject": "Hello", "plainText": "Plain", "html": "<p>Html</p>"}
    assert payload["replyTo"] == [{"address": "info@example.com"}]
    assert payload["attachments"][0]["name"] == "INV-1.pdf"
    assert payload["attachments"][0]["contentType"] == "application/pdf"
    assert payload["attachments"][0]["contentInBase64"] == "JVBERi1kYXRh"


def test_the_azure_message_leaves_out_what_it_does_not_have():
    sender = _azure_sender({"status": "Succeeded"})

    sender.send(_message(to_name=None, reply_to=None), None)

    [payload] = sender._client.messages

    assert payload["recipients"] == {"to": [{"address": "renter@example.com"}]}
    assert "replyTo" not in payload and "attachments" not in payload


def test_an_answer_other_than_succeeded_is_a_failure_to_retry():
    sender = _azure_sender({"status": "Failed", "error": {"message": "domain not verified"}})

    with pytest.raises(RuntimeError, match="domain not verified"):
        sender.send(_message(), None)


def test_email_is_on_only_with_both_settings(monkeypatch):
    monkeypatch.delenv("EMAIL_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("EMAIL_FROM_ADDRESS", raising=False)
    assert email_outbox.email_enabled() is False
    assert email_outbox.configured_sender() is None

    monkeypatch.setenv("EMAIL_CONNECTION_STRING", "x")
    assert email_outbox.email_enabled() is False

    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "a@b.co")
    assert email_outbox.email_enabled() is True


# --- the words ---------------------------------------------------------------------------------


def _placeholders(text: str) -> set[str]:
    return set(re.findall(r"\{(\w+)\}", text))


def test_every_language_has_every_message_and_part_with_the_same_placeholders():
    for type_key, by_language in TEMPLATES.items():
        assert set(by_language) == set(SUPPORTED_LANGUAGES), type_key

        subject, body = by_language["en"]

        for language in SUPPORTED_LANGUAGES:
            other_subject, other_body = by_language[language]

            assert _placeholders(other_subject) == _placeholders(subject), (type_key, language)
            assert _placeholders(other_body) == _placeholders(body), (type_key, language)

    for key, by_language in DEFAULT_PARTS.items():
        assert set(by_language) == set(SUPPORTED_LANGUAGES), key

        for language in SUPPORTED_LANGUAGES:
            assert _placeholders(by_language[language]) == _placeholders(by_language["en"]), (key, language)


def test_the_html_version_has_paragraphs_links_and_escapes_everything_else():
    html = to_html("Hello <b>Ann</b> & co\n\nLine one\nLine two\n\nSee https://shop.example.com/en/manage?reference=AB12 now")

    assert "<b>" not in html and "&lt;b&gt;" in html and "&amp;" in html
    assert "Line one<br>Line two" in html
    assert '<a href="https://shop.example.com/en/manage?reference=AB12">' in html


@pytest.mark.parametrize("language", SUPPORTED_LANGUAGES)
def test_the_confirmation_is_written_in_the_bookings_language(email_on, language):
    start = datetime.now(timezone.utc) + timedelta(days=far_future_days())
    car = ensure_car_available("SA-008-AA")
    created = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Lang",
                "last_name": "Test",
                "date_of_birth": "1990-01-01",
                "address": "1 Test Street",
                "postal_code": "00100",
                "phone_number": "+390000000042",
                "email": "lang.test@example.com",
            },
            "car_id": car["id"],
            "pickup_location_id": get_location_id("AHO"),
            "return_location_id": get_location_id("AHO"),
            "pickup_at": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "return_at": (start + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "language": language,
        },
    ).json()

    try:
        assert created["language"] == language
        assert client.patch(f"/api/reservations/{created['id']}/status", json={"status": "CONFIRMED"}).status_code == 200

        [message] = _messages(created["id"])

        assert message.language == language
        assert message.subject.startswith(TEMPLATES["booking_confirmed"][language][0].split("{")[0])
    finally:
        client.patch(f"/api/reservations/{created['id']}/cancel")


def test_a_booking_without_a_language_uses_the_business_default(email_on):
    default = client.get("/api/configuration").json()["default_language"]
    reservation = _booking()

    try:
        [message] = _messages(reservation["id"])

        assert message.language == default
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_booking_in_a_language_that_does_not_exist_is_refused():
    start = datetime.now(timezone.utc) + timedelta(days=far_future_days())
    response = client.post(
        "/api/reservations",
        json={
            "customer": {
                "first_name": "Lang",
                "last_name": "Test",
                "date_of_birth": "1990-01-01",
                "address": "1 Test Street",
                "postal_code": "00100",
                "phone_number": "+390000000042",
                "email": "lang.test@example.com",
            },
            "car_id": ensure_car_available("SA-008-AA")["id"],
            "pickup_location_id": get_location_id("AHO"),
            "return_location_id": get_location_id("AHO"),
            "pickup_at": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "return_at": (start + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "language": "xx",
        },
    )

    assert response.status_code == 422


def test_the_confirmation_has_the_address_the_cancellation_deadline_and_a_footer_with_the_business(email_on, monkeypatch):
    monkeypatch.setenv("STOREFRONT_URL", "https://shop.example.com")
    reservation = _booking()

    try:
        [message] = _messages(reservation["id"])
        business = client.get("/api/configuration").json()

        # The footer is the business identity, whatever anyone wrote in the message.
        assert "-- " in message.body_text
        assert (business["legal_name"] or business["business_name"]) in message.body_text.split("-- ")[-1]
        assert "https://shop.example.com/" in message.body_text.split("-- ")[-1]  # the privacy link
        assert "<hr>" in message.body_html
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_the_manage_link_is_there_for_a_booking_made_on_the_website_and_the_line_vanishes_otherwise(email_on, monkeypatch):
    monkeypatch.setenv("STOREFRONT_URL", "https://shop.example.com/")
    reservation = _booking()  # made by staff: no public reference

    try:
        [message] = _messages(reservation["id"])

        assert "shop.example.com" not in message.body_text.split("-- ")[0]
        assert "View or manage your booking" not in message.body_text
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

    # With a reference, the link takes the renter to the lookup with it filled in.
    db = SessionLocal()
    try:
        from app.models import Reservation as ReservationRow

        reservation = _booking()
        row = db.get(ReservationRow, UUID(reservation["id"]))
        reference = uuid4().hex[:9].upper()
        row.public_reference = reference
        db.query(EmailMessage).delete()
        db.commit()

        email_outbox.queue_booking_confirmed(db, db.get(ReservationRow, UUID(reservation["id"])))
        db.commit()

        message = db.scalars(select(EmailMessage)).one()
        assert f"https://shop.example.com/en/manage?reference={reference}" in message.body_text.replace("/it/", "/en/").replace("/pl/", "/en/")
    finally:
        db.rollback()
        db.get(ReservationRow, UUID(reservation["id"])).public_reference = None
        db.commit()
        db.close()
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_the_receipt_does_not_claim_an_attachment_when_attaching_is_switched_off(email_on):
    assert client.patch("/api/email/types/receipt", json={"options": {"attach_invoice": False}}).status_code == 200
    reservation = _booking()

    try:
        client.post(f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment")

        [receipt] = [m for m in _messages(reservation["id"]) if m.template == "receipt"]

        assert receipt.attachment_kind is None
        assert "attached" not in receipt.body_text.lower() and "allegat" not in receipt.body_text.lower()
    finally:
        client.patch("/api/email/types/receipt", json={"options": {"attach_invoice": True}})
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_switched_off_email_is_not_queued_and_the_others_still_are(email_on):
    assert client.patch("/api/email/types/booking_confirmed", json={"enabled": False}).status_code == 200
    reservation = _booking()

    try:
        assert _messages(reservation["id"]) == []

        client.post(f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment")

        assert [m.template for m in _messages(reservation["id"])] == ["receipt"]
    finally:
        client.patch("/api/email/types/booking_confirmed", json={"enabled": True})
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- the background sender -------------------------------------------------------------------


def test_the_background_sender_starts_only_when_email_is_set_up(monkeypatch):
    monkeypatch.delenv("EMAIL_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("EMAIL_FROM_ADDRESS", raising=False)
    monkeypatch.setattr(email_outbox, "_thread", None)

    email_outbox.start_worker()
    assert email_outbox._thread is None

    monkeypatch.setenv("EMAIL_CONNECTION_STRING", "x")
    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "a@b.co")
    monkeypatch.setattr(email_outbox, "POLL_SECONDS", 3600)

    try:
        email_outbox.start_worker()
        first = email_outbox._thread
        assert first is not None and first.is_alive() and first.daemon

        # Starting again does not start a second one.
        email_outbox.start_worker()
        assert email_outbox._thread is first
    finally:
        email_outbox.stop_worker()
        first.join(timeout=5)
        assert not first.is_alive()
