"""
The Email section of Configuration: status, pause, test, reword, preview, what was
sent. Azure is replaced by a fake sender.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.database import SessionLocal
from app.dependencies import get_current_user
from app.i18n.emails import GROUPS, TEXT, placeholders_of
from app.languages import SUPPORTED_LANGUAGES
from app.main import app
from app.models import AuditLog, EmailMessage, EmailSettings, EmailTextOverride, User
from app.services import email_outbox
from tests._dates import far_future_days
from tests.test_handovers import create_confirmed_reservation

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    yield

    db = SessionLocal()
    try:
        db.execute(delete(EmailMessage))
        db.execute(delete(EmailTextOverride))
        settings = db.get(EmailSettings, 1)
        if settings is not None:
            settings.enabled = True
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


def _save(language, key, text):
    return client.put("/api/email/texts", json={"language": language, "key": key, "text": text})


# --- status and pausing ------------------------------------------------------------------------


def test_the_status_says_whether_email_is_set_up_and_what_is_waiting(monkeypatch):
    monkeypatch.delenv("EMAIL_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("EMAIL_FROM_ADDRESS", raising=False)

    off = client.get("/api/email/status").json()

    assert off["set_up"] is False and off["from_address"] is None and off["paused"] is False
    assert off["pending"] == 0 and off["failed"] == 0 and off["language"] in SUPPORTED_LANGUAGES

    monkeypatch.setenv("EMAIL_CONNECTION_STRING", "x")
    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "bookings@example.com")

    assert client.get("/api/email/status").json()["set_up"] is True
    assert client.get("/api/email/status").json()["from_address"] == "bookings@example.com"


def test_pausing_stops_new_emails_being_queued_and_resuming_starts_them_again(email_on):
    paused = client.put("/api/email/paused", json={"paused": True})

    assert paused.status_code == 200 and paused.json()["paused"] is True

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

    db = SessionLocal()
    try:
        actions = [e.action for e in db.scalars(select(AuditLog).where(AuditLog.action.in_(("email.paused", "email.resumed"))))]
    finally:
        db.close()

    assert "email.paused" in actions and "email.resumed" in actions


def test_the_sending_worker_leaves_messages_waiting_while_paused(email_on, monkeypatch):
    reservation = _booking()

    try:
        client.put("/api/email/paused", json={"paused": True})

        db = SessionLocal()
        try:
            assert email_outbox.email_paused(db) is True
        finally:
            db.close()

        # Queued before the pause: it is still there, unsent, until sending resumes.
        [message] = _messages()
        assert message.status == "PENDING"
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- the wording -------------------------------------------------------------------------------


def test_the_catalog_lists_every_line_of_every_email_with_its_allowed_names():
    body = client.get("/api/email/texts").json()
    listed = {line["key"]: line for group in body["groups"] for line in group["lines"]}

    assert {group["id"] for group in body["groups"]} == set(GROUPS)
    assert set(listed) == {key for keys in GROUPS.values() for key in keys}

    greeting = listed["greeting"]
    assert greeting["placeholders"] == ["name"] and greeting["is_subject"] is False
    assert listed["confirmed.subject"]["is_subject"] is True
    assert set(listed["confirmed.pickup"]["placeholders"]) == {"place", "when"}
    assert set(greeting["defaults"]) == set(SUPPORTED_LANGUAGES) and greeting["overrides"] == {}


def test_every_editable_line_uses_the_same_names_in_every_language():
    for keys in GROUPS.values():
        for key in keys:
            names = {language: set(placeholders_of(key)) for language in SUPPORTED_LANGUAGES}

            assert len({frozenset(value) for value in names.values()}) == 1, key
            assert TEXT["en"][key], key


def test_a_reworded_line_is_used_in_the_next_email_in_that_language_only(email_on):
    assert _save("en", "confirmed.subject", "All set, {reference}! - {business}").status_code == 200
    assert _save("en", "greeting", "Hey {name},").status_code == 200
    assert _save("it", "greeting", "Ciao {name},").status_code == 200

    catalog = client.get("/api/email/texts").json()
    greeting = next(l for g in catalog["groups"] for l in g["lines"] if l["key"] == "greeting")
    assert greeting["overrides"] == {"en": "Hey {name},", "it": "Ciao {name},"}

    reservation = _booking()
    try:
        [message] = _messages()
        language = client.get("/api/email/status").json()["language"]

        if language == "en":
            assert message.subject.startswith("All set, ") and message.subject.endswith(" - " + client.get("/api/configuration").json()["business_name"])
            assert message.body_text.startswith("Hey Test,")
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_an_empty_line_is_left_out_of_the_email(email_on):
    assert _save("en", "confirmed.bring", "").status_code == 200
    assert _save("it", "confirmed.bring", "").status_code == 200
    assert _save("pl", "confirmed.bring", "").status_code == 200

    reservation = _booking()
    try:
        [message] = _messages()

        for language in SUPPORTED_LANGUAGES:
            assert TEXT[language]["confirmed.bring"] not in message.body_text

        assert "\n\n\n" not in message.body_text
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_a_subject_cannot_be_empty_but_other_lines_can():
    refused = _save("en", "confirmed.subject", "   ")

    assert refused.status_code == 400 and refused.json()["code"] == "email.subject_empty"
    assert _save("en", "confirmed.intro", "").status_code == 200


@pytest.mark.parametrize(
    ("key", "text", "code"),
    [
        ("greeting", "Hi {nme}", "email.unknown_placeholder"),
        ("greeting", "Hi {name.__class__}", "email.unknown_placeholder"),
        ("greeting", "Hi {name!r}", "email.unknown_placeholder"),
        ("greeting", "Hi {name:>20}", "email.unknown_placeholder"),
        ("greeting", "Hi {0}", "email.unknown_placeholder"),
        ("greeting", "Hi {name", "email.braces"),
        ("greeting", "Hi name}", "email.braces"),
        ("confirmed.subject", "line one\nline two", "email.subject_one_line"),
        ("greeting", "x" * 2001, "email.too_long"),
        ("not.a.line", "x", "email.unknown_line"),
    ],
)
def test_wording_that_would_break_an_email_is_refused_when_it_is_saved(key, text, code):
    response = _save("en", key, text)

    assert response.status_code == 400, text
    assert response.json()["code"] == code

    db = SessionLocal()
    try:
        assert db.scalars(select(EmailTextOverride)).all() == []
    finally:
        db.close()


def test_the_refusal_names_what_is_allowed_on_that_line():
    body = _save("en", "confirmed.pickup", "At {where}").json()

    assert body["code"] == "email.unknown_placeholder"
    assert body["params"]["name"] == "{where}"
    assert "{place}" in body["params"]["allowed"] and "{when}" in body["params"]["allowed"]


def test_an_unknown_language_is_refused():
    assert _save("fr", "greeting", "Bonjour {name}").json()["code"] == "email.unknown_language"
    assert client.delete("/api/email/texts/fr/greeting").json()["code"] == "email.unknown_language"


def test_resetting_a_line_goes_back_to_the_built_in_wording_and_is_audited():
    _save("en", "greeting", "Yo {name}")

    reset = client.delete("/api/email/texts/en/greeting")

    assert reset.status_code == 200
    greeting = next(l for g in reset.json()["groups"] for l in g["lines"] if l["key"] == "greeting")
    assert greeting["overrides"] == {}

    # Resetting what was never changed is not an error.
    assert client.delete("/api/email/texts/en/greeting").status_code == 200

    db = SessionLocal()
    try:
        actions = [e.action for e in db.scalars(select(AuditLog).where(AuditLog.action.like("email.text_%")))]
    finally:
        db.close()

    assert "email.text_changed" in actions and "email.text_reset" in actions


def test_a_stored_line_that_can_no_longer_be_filled_in_never_stops_an_email(email_on):
    # Written straight to the table, around the checks, as a bad row from an older
    # version or by hand would be.
    db = SessionLocal()
    try:
        for language in SUPPORTED_LANGUAGES:
            db.add(EmailTextOverride(key="greeting", language=language, text="Hello {nobody}"))
            db.add(EmailTextOverride(key="confirmed.subject", language=language, text="{broken"))
        db.commit()
    finally:
        db.close()

    reservation = _booking()
    try:
        [message] = _messages()

        assert message.subject and "{" not in message.subject
        assert "Hello {nobody}" not in message.body_text
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


# --- preview -----------------------------------------------------------------------------------


def test_the_preview_shows_unsaved_edits_with_sample_values_without_saving_them():
    preview = client.post(
        "/api/email/preview",
        json={
            "template": "booking_confirmed",
            "language": "en",
            "edits": {"greeting": "Dear {name},", "confirmed.subject": "Booked: {reference}"},
        },
    )

    assert preview.status_code == 200
    body = preview.json()
    assert body["subject"] == "Booked: SAMPLE-1234"
    assert body["body"].startswith("Dear Giulia,")
    assert "Fiat Panda" in body["body"] and "27.00 EUR" in body["body"]

    assert client.get("/api/email/texts").json()["groups"][0]["lines"][0]["overrides"] == {}


def test_the_preview_of_each_email_uses_its_own_sample_and_hides_what_does_not_apply():
    cancelled = client.post("/api/email/preview", json={"template": "booking_cancelled", "language": "en", "edits": {}}).json()
    receipt = client.post("/api/email/preview", json={"template": "receipt", "language": "en", "edits": {}}).json()

    assert "refunded" in cancelled["body"] and "27.00 EUR" in cancelled["body"]
    assert "INV-000123" in receipt["subject"] and "attached" in receipt["body"]

    kept = client.post(
        "/api/email/preview",
        json={"template": "booking_confirmed", "language": "en", "edits": {"confirmed.paid_online": ""}},
    ).json()

    assert "Paid online" not in kept["body"]


def test_the_preview_refuses_bad_edits_and_unknown_emails():
    bad = client.post("/api/email/preview", json={"template": "receipt", "language": "en", "edits": {"greeting": "Hi {x}"}})
    assert bad.status_code == 400 and bad.json()["code"] == "email.unknown_placeholder"

    unknown = client.post("/api/email/preview", json={"template": "newsletter", "language": "en", "edits": {}})
    assert unknown.status_code == 400 and unknown.json()["code"] == "email.unknown_template"


@pytest.mark.parametrize("language", SUPPORTED_LANGUAGES)
def test_every_email_previews_in_every_language(language):
    for template in ("booking_confirmed", "booking_cancelled", "receipt"):
        body = client.post("/api/email/preview", json={"template": template, "language": language, "edits": {}})

        assert body.status_code == 200, (template, language)
        assert body.json()["subject"] and body.json()["body"]


# --- test email --------------------------------------------------------------------------------


class FakeSender:
    def __init__(self, error=None):
        self.error = error
        self.sent = []

    def send(self, message, attachment):
        if self.error:
            raise RuntimeError(self.error)

        self.sent.append((message.to_address, message.subject, message.body_text, attachment))


def test_a_test_email_goes_straight_out_and_reports_success(email_on, monkeypatch):
    fake = FakeSender()
    monkeypatch.setattr(email_outbox, "configured_sender", lambda: fake)

    result = client.post("/api/email/test", json={"to_address": "owner@example.com"})

    assert result.status_code == 200
    assert result.json() == {"sent": True, "error": None, "to": "owner@example.com"}
    [(to, subject, body, attachment)] = fake.sent
    assert to == "owner@example.com" and "test" in subject.lower() and attachment is None
    # Not recorded in the outbox.
    assert _messages() == []


def test_a_failed_test_email_shows_what_the_service_said(email_on, monkeypatch):
    monkeypatch.setattr(email_outbox, "configured_sender", lambda: FakeSender("Sender domain is not verified"))

    result = client.post("/api/email/test", json={"to_address": "owner@example.com"}).json()

    assert result["sent"] is False and "not verified" in result["error"]


def test_a_test_email_needs_email_to_be_set_up_and_a_real_address(monkeypatch):
    monkeypatch.delenv("EMAIL_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("EMAIL_FROM_ADDRESS", raising=False)

    refused = client.post("/api/email/test", json={"to_address": "owner@example.com"})
    assert refused.status_code == 400 and refused.json()["code"] == "email.not_set_up"

    monkeypatch.setenv("EMAIL_CONNECTION_STRING", "x")
    monkeypatch.setenv("EMAIL_FROM_ADDRESS", "bookings@example.com")

    for address in ("nonsense", "a b@c.de", "@x.co"):
        bad = client.post("/api/email/test", json={"to_address": address})
        assert bad.status_code == 400 and bad.json()["code"] == "email.test_address_invalid"


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

        assert again.status_code == 200
        assert again.json()["status"] == "PENDING" and again.json()["attempts"] == 0

        # Only a failed one can be retried; an unknown one is not found.
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
            ("GET", "/api/email/texts"),
            ("PUT", "/api/email/texts"),
            ("POST", "/api/email/preview"),
            ("POST", "/api/email/test"),
            ("GET", "/api/email/messages"),
            ("POST", f"/api/email/messages/{uuid4()}/retry"),
        ):
            assert client.request(method, path).status_code == 403, (role, method, path)
    finally:
        app.dependency_overrides[get_current_user] = original
