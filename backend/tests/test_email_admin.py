"""
Configuration > Email: status, pause, reply-to, the list of emails and their
options, per-language messages, reusable parts, preview, test send, what was sent.
Azure is replaced by a fake sender.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.i18n.email_templates import TEMPLATES
from app.languages import SUPPORTED_LANGUAGES
from app.main import app
from app.models import AuditLog, EmailMessage, EmailPart, EmailSettings, EmailTemplate, EmailTypeSetting, User
from app.services import email_outbox
from app.services.email_types import PARTS, TYPES
from tests._dates import far_future_days
from tests.test_handovers import create_confirmed_reservation

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    yield

    db = SessionLocal()
    try:
        for model in (EmailMessage, EmailTemplate, EmailPart, EmailTypeSetting):
            db.execute(delete(model))
        settings = db.get(EmailSettings, 1)
        if settings is not None:
            settings.enabled = True
            settings.reply_to = None
        db.commit()
    finally:
        db.close()


@pytest.fixture
def email_on(monkeypatch):
    monkeypatch.setenv("EMAIL_CONNECTION_STRING", "endpoint=https://example.communication.azure.com/;accesskey=fake")
    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "bookings@example.com")


def _booking():
    start = datetime.now(timezone.utc) + timedelta(days=far_future_days())

    return create_confirmed_reservation(
        "SA-008-AA",
        start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        (start + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _messages():
    db = SessionLocal()
    try:
        rows = list(db.scalars(select(EmailMessage).order_by(EmailMessage.created_at)))
        db.expunge_all()

        return rows
    finally:
        db.close()


def _save(key, language, subject, body):
    return client.put(f"/api/email/types/{key}/templates/{language}", json={"subject": subject, "body": body})


def _actions(prefix="email."):
    db = SessionLocal()
    try:
        return [e.action for e in db.scalars(select(AuditLog).where(AuditLog.action.like(prefix + "%")))]
    finally:
        db.close()


# --- status, pause, reply-to -------------------------------------------------------------------


def test_the_status_says_whether_email_is_set_up_and_what_is_waiting(monkeypatch):
    monkeypatch.delenv("EMAIL_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("EMAIL_FROM_ADDRESS", raising=False)
    monkeypatch.delenv("STOREFRONT_URL", raising=False)

    off = client.get("/api/email/status").json()

    assert off["set_up"] is False and off["from_address"] is None and off["paused"] is False
    assert off["storefront_url"] is None and off["pending"] == 0 and off["failed"] == 0
    assert off["default_language"] in SUPPORTED_LANGUAGES

    monkeypatch.setenv("EMAIL_CONNECTION_STRING", "x")
    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "bookings@example.com")
    monkeypatch.setenv("STOREFRONT_URL", "https://shop.example.com/")

    on = client.get("/api/email/status").json()
    assert on["set_up"] is True and on["from_address"] == "bookings@example.com"
    assert on["storefront_url"] == "https://shop.example.com"


def test_pausing_stops_new_emails_being_queued_and_resuming_starts_them_again(email_on):
    assert client.put("/api/email/paused", json={"paused": True}).json()["paused"] is True

    reservation = _booking()
    try:
        assert _messages() == []
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

    assert client.put("/api/email/paused", json={"paused": False}).json()["paused"] is False

    reservation = _booking()
    try:
        assert [m.template for m in _messages()] == ["booking_confirmed"]
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

    assert {"email.paused", "email.resumed"} <= set(_actions())


def test_the_reply_to_address_defaults_to_the_business_email_and_can_be_overridden(email_on):
    # An empty Business email means there is no default reply address.
    business_email = client.get("/api/configuration").json()["email"] or None

    status = client.get("/api/email/status").json()
    assert status["reply_to"] is None and status["reply_to_default"] == business_email

    reservation = _booking()
    try:
        assert _messages()[-1].reply_to == business_email
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

    assert client.put("/api/email/reply-to", json={"reply_to": "  bookings@example.org "}).json()["reply_to"] == "bookings@example.org"

    reservation = _booking()
    try:
        assert [m.reply_to for m in _messages()][-1] == "bookings@example.org"
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")

    # Empty goes back to the business email.
    assert client.put("/api/email/reply-to", json={"reply_to": ""}).json()["reply_to"] is None

    refused = client.put("/api/email/reply-to", json={"reply_to": "not an address"})
    assert refused.status_code == 400 and refused.json()["code"] == "email.address_invalid"
    assert "email.reply_to_changed" in _actions()


# --- the emails --------------------------------------------------------------------------------


def test_the_list_has_every_email_with_who_it_goes_to_and_whether_it_is_on():
    rows = {row["key"]: row for row in client.get("/api/email/types").json()}

    assert set(rows) == set(TYPES)
    assert rows["booking_confirmed"]["audience"] == "renter"
    assert all(row["enabled"] is True and row["customised_languages"] == [] for row in rows.values())
    assert rows["receipt"]["options"] == {"attach_invoice": True}
    assert rows["receipt"]["option_kinds"] == {"attach_invoice": "bool"}


def test_the_detail_has_the_message_in_every_language_with_its_default_and_what_it_may_use():
    detail = client.get("/api/email/types/booking_confirmed").json()

    assert set(detail["languages"]) == set(SUPPORTED_LANGUAGES)
    english = detail["languages"]["en"]
    assert (english["subject"], english["body"]) == TEMPLATES["booking_confirmed"]["en"]
    assert english["customised"] is False and english["default_subject"] == english["subject"]
    assert "reference" in detail["values"] and "manage_link" in detail["parts"] and "business" in detail["global_values"]

    assert client.get("/api/email/types/newsletter").status_code == 404


def test_an_email_can_be_switched_off_and_on_and_options_are_checked():
    assert client.patch("/api/email/types/receipt", json={"enabled": False}).json()["enabled"] is False
    assert client.patch("/api/email/types/receipt", json={"enabled": True}).json()["enabled"] is True
    assert client.patch("/api/email/types/receipt", json={"options": {"attach_invoice": False}}).json()["options"] == {"attach_invoice": False}

    for options in ({"attach_invoice": "yes"}, {"nonsense": True}):
        refused = client.patch("/api/email/types/receipt", json={"options": options})
        assert refused.status_code == 400

    assert client.patch("/api/email/types/receipt", json={"options": {"attach_invoice": "yes"}}).json()["code"] == "email.option_invalid"
    assert client.patch("/api/email/types/receipt", json={"options": {"nonsense": True}}).json()["code"] == "email.unknown_option"
    assert client.patch("/api/email/types/receipt", json={"surprise": 1}).status_code == 422
    assert "email.type_changed" in _actions()


def test_a_security_email_cannot_be_switched_off(monkeypatch):
    # No security email exists yet; this is the rule they will be subject to.
    from dataclasses import replace

    monkeypatch.setitem(TYPES, "receipt", replace(TYPES["receipt"], can_disable=False))

    refused = client.patch("/api/email/types/receipt", json={"enabled": False})

    assert refused.status_code == 400 and refused.json()["code"] == "email.cannot_disable"
    assert client.get("/api/email/types/receipt").json()["enabled"] is True


# --- the messages ------------------------------------------------------------------------------


def test_a_message_the_business_wrote_is_used_in_the_next_email_in_that_language_only(email_on):
    assert _save("booking_confirmed", "en", "All set, {reference}! - {business}", "Hey {name},\n\nSee you at {pickup_place}.\n\n{signoff}").status_code == 200
    assert _save("booking_confirmed", "it", "Tutto pronto", "Ciao {name}").status_code == 200

    detail = client.get("/api/email/types/booking_confirmed").json()
    assert detail["languages"]["en"]["customised"] is True
    assert detail["languages"]["pl"]["customised"] is False
    assert client.get("/api/email/types").json()[0]["customised_languages"] == ["en", "it"]

    default = client.get("/api/configuration").json()["default_language"]
    reservation = _booking()
    try:
        [message] = _messages()

        if default == "en":
            assert message.subject.startswith("All set, ")
            assert message.body_text.startswith("Hey Test,")
            assert "See you at" in message.body_text
        else:
            assert message.language == default
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


@pytest.mark.parametrize(
    ("subject", "body", "code"),
    [
        ("Hi {nme}", "ok", "email.unknown_placeholder"),
        ("ok", "Hi {name.__class__}", "email.unknown_placeholder"),
        ("ok", "Hi {name!r}", "email.unknown_placeholder"),
        ("{manage_link}", "ok", "email.unknown_placeholder"),
        ("ok", "Hi {name", "email.braces"),
        ("a\nb", "ok", "email.one_line"),
        ("   ", "ok", "email.empty"),
        ("ok", "", "email.empty"),
        ("x" * 301, "ok", "email.too_long"),
    ],
)
def test_wording_that_would_break_an_email_is_refused_when_it_is_saved(subject, body, code):
    response = _save("booking_confirmed", "en", subject, body)

    assert response.status_code == 400, (subject, body)
    assert response.json()["code"] == code

    db = SessionLocal()
    try:
        assert db.scalars(select(EmailTemplate)).all() == []
    finally:
        db.close()


def test_the_refusal_names_what_is_allowed():
    body = _save("booking_cancelled", "en", "ok", "At {pickup_place}").json()

    assert body["code"] == "email.unknown_placeholder"
    assert body["params"]["name"] == "{pickup_place}"
    assert "{amount}" in body["params"]["allowed"] and "{payment_note}" in body["params"]["allowed"]


def test_an_unknown_email_or_language_is_refused():
    assert _save("newsletter", "en", "a", "b").status_code == 404
    assert _save("receipt", "fr", "a", "b").json()["code"] == "email.unknown_language"
    assert client.delete("/api/email/types/receipt/templates/fr").json()["code"] == "email.unknown_language"


def test_resetting_a_message_goes_back_to_the_built_in_wording_and_is_audited():
    _save("receipt", "en", "Receipt!", "Thanks {name}")

    reset = client.delete("/api/email/types/receipt/templates/en")

    assert reset.status_code == 200
    english = reset.json()["languages"]["en"]
    assert english["customised"] is False and (english["subject"], english["body"]) == TEMPLATES["receipt"]["en"]

    # Resetting what was never changed is not an error.
    assert client.delete("/api/email/types/receipt/templates/en").status_code == 200
    assert {"email.template_changed", "email.template_reset"} <= set(_actions())


def test_saving_the_same_wording_twice_is_not_audited_twice():
    _save("receipt", "en", "Receipt!", "Thanks {name}")
    before = _actions().count("email.template_changed")

    _save("receipt", "en", "Receipt!", "Thanks {name}")

    assert _actions().count("email.template_changed") == before


# --- the reusable parts ------------------------------------------------------------------------


def test_the_parts_list_has_every_part_and_variant_with_where_it_is_used():
    rows = {row["key"]: row for row in client.get("/api/email/parts").json()}

    assert set(rows) == {key for part in PARTS.values() for key in part.storage_keys}
    assert rows["payment_note.refunded"]["part"] == "payment_note" and rows["payment_note.refunded"]["variant"] == "refunded"
    assert rows["signoff"]["variant"] is None and set(rows["signoff"]["used_by"]) == set(TYPES)
    assert rows["bring_list"]["used_by"] == ["booking_confirmed"]
    assert rows["manage_link"]["values"] == ["manage_url"]
    assert rows["bring_list"]["languages"]["en"]["customised"] is False


def test_a_part_the_business_wrote_is_used_in_the_emails_and_an_empty_one_leaves_its_line_out(email_on):
    default = client.get("/api/configuration").json()["default_language"]
    assert client.put(f"/api/email/parts/bring_list/{default}", json={"text": "Bring your passport."}).status_code == 200
    assert client.put(f"/api/email/parts/cancellation_policy/{default}", json={"text": ""}).status_code == 200

    reservation = _booking()
    try:
        [message] = _messages()

        assert "Bring your passport." in message.body_text
        assert "\n\n\n" not in message.body_text
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


@pytest.mark.parametrize(
    ("key", "text", "code"),
    [
        ("bring_list", "{name}", "email.unknown_placeholder"),
        ("manage_link", "{manage_url", "email.braces"),
        ("bring_list", "x" * 2001, "email.too_long"),
        ("not_a_part", "x", "email.unknown_part"),
    ],
)
def test_a_part_that_would_break_an_email_is_refused(key, text, code):
    response = client.put(f"/api/email/parts/{key}/en", json={"text": text})

    assert response.status_code == 400 and response.json()["code"] == code


def test_resetting_a_part_goes_back_to_the_built_in_wording():
    client.put("/api/email/parts/bring_list/en", json={"text": "Passport."})

    rows = {row["key"]: row for row in client.delete("/api/email/parts/bring_list/en").json()}

    assert rows["bring_list"]["languages"]["en"]["customised"] is False
    assert client.delete("/api/email/parts/nonsense/en").json()["code"] == "email.unknown_part"
    assert {"email.part_changed", "email.part_reset"} <= set(_actions())


# --- preview -----------------------------------------------------------------------------------


def test_the_preview_shows_a_draft_with_sample_values_and_the_footer_without_saving_it():
    preview = client.post(
        "/api/email/preview",
        json={"type": "booking_confirmed", "language": "en", "subject": "Booked: {reference}", "body": "Dear {name},\n\n{signoff}", "parts": {"signoff": "Ciao from {business}"}},
    )

    assert preview.status_code == 200
    body = preview.json()
    assert body["subject"] == "Booked: AB12CD34E"
    assert body["body"].startswith("Dear Giulia,") and "Ciao from Sample Rentals" in body["body"]
    assert "Sample Rentals S.r.l." in body["body"]

    detail = client.get("/api/email/types/booking_confirmed").json()
    assert detail["languages"]["en"]["customised"] is False
    assert not any(row["languages"]["en"]["customised"] for row in client.get("/api/email/parts").json())


def test_the_preview_of_each_email_in_each_language_works_and_uses_the_saved_wording_when_there_is_no_draft():
    for type_key in TYPES:
        for language in SUPPORTED_LANGUAGES:
            response = client.post("/api/email/preview", json={"type": type_key, "language": language})

            assert response.status_code == 200, (type_key, language)
            assert response.json()["subject"] and response.json()["body"]

    _save("receipt", "en", "Saved {number}", "Saved body {name}")
    saved = client.post("/api/email/preview", json={"type": "receipt", "language": "en"}).json()

    assert saved["subject"] == "Saved INV-000123" and saved["body"].startswith("Saved body Giulia")


def test_the_preview_refuses_a_bad_draft_exactly_as_saving_would_and_unknown_emails():
    bad = client.post("/api/email/preview", json={"type": "receipt", "language": "en", "body": "Hi {x}"})
    assert bad.status_code == 400 and bad.json()["code"] == "email.unknown_placeholder"

    bad_part = client.post("/api/email/preview", json={"type": "receipt", "language": "en", "parts": {"signoff": "{x}"}})
    assert bad_part.status_code == 400

    assert client.post("/api/email/preview", json={"type": "newsletter", "language": "en"}).status_code == 404
    assert client.post("/api/email/preview", json={"type": "receipt", "language": "fr"}).json()["code"] == "email.unknown_language"


# --- test email --------------------------------------------------------------------------------


class FakeSender:
    def __init__(self, error=None):
        self.error = error
        self.sent = []

    def send(self, message, attachment):
        if self.error:
            raise RuntimeError(self.error)

        self.sent.append((message.to_address, message.subject, message.body_text, message.reply_to, attachment))


def test_a_connection_test_goes_straight_out_and_reports_success(email_on, monkeypatch):
    fake = FakeSender()
    monkeypatch.setattr(email_outbox, "configured_sender", lambda: fake)

    result = client.post("/api/email/test", json={"to_address": "owner@example.com"})

    assert result.status_code == 200 and result.json() == {"sent": True, "error": None, "to": "owner@example.com"}
    [(to, subject, _body, _reply, attachment)] = fake.sent
    assert to == "owner@example.com" and "test" in subject.lower() and attachment is None
    assert _messages() == []


def test_a_test_of_one_email_sends_it_as_it_reads_now_with_sample_values(email_on, monkeypatch):
    fake = FakeSender()
    monkeypatch.setattr(email_outbox, "configured_sender", lambda: fake)
    _save("receipt", "en", "Saved {number}", "Saved body {name}\n\n{signoff}")

    result = client.post("/api/email/test", json={"to_address": "owner@example.com", "type": "receipt", "language": "en"})

    assert result.json()["sent"] is True
    [(_to, subject, body, _reply, _attachment)] = fake.sent
    assert subject == "[TEST] Saved INV-000123" and body.startswith("Saved body Giulia")
    assert "Sample Rentals S.r.l." in body


def test_a_failed_test_shows_what_the_service_said(email_on, monkeypatch):
    monkeypatch.setattr(email_outbox, "configured_sender", lambda: FakeSender("Sender domain is not verified"))

    result = client.post("/api/email/test", json={"to_address": "owner@example.com"}).json()

    assert result["sent"] is False and "not verified" in result["error"]
    assert "email.test_failed" in _actions()


def test_a_test_needs_email_to_be_set_up_a_real_address_and_a_known_email(monkeypatch):
    monkeypatch.delenv("EMAIL_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("EMAIL_FROM_ADDRESS", raising=False)

    refused = client.post("/api/email/test", json={"to_address": "owner@example.com"})
    assert refused.status_code == 400 and refused.json()["code"] == "email.not_set_up"

    monkeypatch.setenv("EMAIL_CONNECTION_STRING", "x")
    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "bookings@example.com")
    monkeypatch.setattr(email_outbox, "configured_sender", lambda: FakeSender())

    for address in ("nonsense", "a b@c.de", "@x.co"):
        bad = client.post("/api/email/test", json={"to_address": address})
        assert bad.status_code == 400 and bad.json()["code"] == "email.test_address_invalid"

    assert client.post("/api/email/test", json={"to_address": "a@b.co", "type": "newsletter"}).status_code == 404


# --- what was sent -----------------------------------------------------------------------------


def test_the_list_shows_recent_emails_and_can_filter_by_status(email_on):
    reservation = _booking()

    try:
        client.post(f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment")

        everything = client.get("/api/email/messages").json()
        assert {m["template"] for m in everything} == {"booking_confirmed", "receipt"}
        assert all(m["status"] == "PENDING" and m["attempts"] == 0 for m in everything)

        assert client.get("/api/email/messages", params={"status": "FAILED"}).json() == []
        assert len(client.get("/api/email/messages", params={"status": "PENDING", "limit": 1}).json()) == 1
        assert client.get("/api/email/messages", params={"status": "BOGUS"}).status_code == 422
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_an_email_that_was_given_up_on_can_be_put_back_in_the_queue(email_on):
    reservation = _booking()

    try:
        db = SessionLocal()
        try:
            message = db.scalars(select(EmailMessage)).first()
            message.status, message.attempts, message.last_error = "FAILED", 6, "boom"
            db.commit()
            message_id = str(message.id)
        finally:
            db.close()

        again = client.post(f"/api/email/messages/{message_id}/retry")

        assert again.status_code == 200 and again.json()["status"] == "PENDING" and again.json()["attempts"] == 0

        second = client.post(f"/api/email/messages/{message_id}/retry")
        assert second.status_code == 400 and second.json()["code"] == "email.only_failed_can_be_retried"
        assert client.post(f"/api/email/messages/{uuid4()}/retry").status_code == 404
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- who may -----------------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["manager", "staff", "readonly"])
def test_only_an_administrator_can_use_any_of_it(role):
    user = User(id=uuid4(), email=f"{role}@example.com", hashed_password="x", role=role, is_active=True)
    original = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: user

    try:
        for method, path in (
            ("GET", "/api/email/status"),
            ("PUT", "/api/email/paused"),
            ("PUT", "/api/email/reply-to"),
            ("GET", "/api/email/types"),
            ("GET", "/api/email/types/receipt"),
            ("PATCH", "/api/email/types/receipt"),
            ("PUT", "/api/email/types/receipt/templates/en"),
            ("DELETE", "/api/email/types/receipt/templates/en"),
            ("GET", "/api/email/parts"),
            ("PUT", "/api/email/parts/bring_list/en"),
            ("POST", "/api/email/preview"),
            ("POST", "/api/email/test"),
            ("GET", "/api/email/messages"),
            ("POST", f"/api/email/messages/{uuid4()}/retry"),
        ):
            assert client.request(method, path).status_code == 403, (role, method, path)
    finally:
        app.dependency_overrides[get_current_user] = original
