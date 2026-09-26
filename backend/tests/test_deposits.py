import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
import stripe
from fastapi.testclient import TestClient

from app.database import SessionLocal
from tests._dates import far_future_days
from app.main import app
from app.models import AuditLog, Car, Handover, Reservation
from tests.test_check_outs import (
    audit_actions,
    cleanup,
    complete,
    condition,
    make_active_reservation,
    pay_cash,
    sign,
)
from tests.test_handovers import (
    TINY_SIGNATURE,
    _employee_sign,
    _mark_identity_verified,
    _reset_identity_verification,
    create_confirmed_reservation,
)
from app.services.return_charges import settle_deposit

client = TestClient(app)

requires_stripe = pytest.mark.skipif(
    not os.getenv("STRIPE_SECRET_KEY"),
    reason="STRIPE_SECRET_KEY not configured in this environment.",
)

DEPOSIT = 200


@pytest.fixture
def deposit_on():
    """Turns the deposit on for a test and puts the configuration back."""

    original = client.get("/api/configuration").json()["security_deposit_amount"]
    assert client.patch(
        "/api/configuration", json={"security_deposit_amount": DEPOSIT}
    ).status_code == 200

    yield

    client.patch("/api/configuration", json={"security_deposit_amount": original})


def deposit_url(reservation_id: str, path: str) -> str:
    return f"/api/reservations/{reservation_id}/handover/deposit/{path}"


def confirmed_paid(plate="SA-008-AA", day=1):
    """A CONFIRMED reservation whose rental payment was taken in cash."""

    base = datetime.now(timezone.utc) + timedelta(days=far_future_days() + day)
    reservation = create_confirmed_reservation(
        plate,
        base.isoformat(),
        (base + timedelta(days=1)).isoformat(),
    )
    client.post(
        f"/api/reservations/{reservation['id']}/handover/confirm-cash-payment"
    )

    return reservation


def handover_row(reservation_id: str) -> Handover:
    db = SessionLocal()
    try:
        return db.query(Handover).filter(
            Handover.reservation_id == UUID(reservation_id)
        ).one()
    finally:
        db.close()


def add_held_deposit(reservation_id: str, method="CASH", amount=DEPOSIT, intent_id=None):
    """A held deposit on an ACTIVE rental, written directly (as check-in would)."""

    db = SessionLocal()
    try:
        handover = db.query(Handover).filter(
            Handover.reservation_id == UUID(reservation_id)
        ).one_or_none()

        if handover is None:
            handover = Handover(
                reservation_id=UUID(reservation_id),
                payment_status="SUCCEEDED",
                payment_method="CASH",
                payment_amount=Decimal("10.00"),
                payment_currency="eur",
            )
            db.add(handover)

        handover.deposit_amount = Decimal(str(amount))
        handover.deposit_currency = "eur"
        handover.deposit_method = method
        handover.deposit_status = "HELD"
        handover.deposit_held_at = datetime.now(timezone.utc)
        handover.deposit_stripe_payment_intent_id = intent_id
        db.commit()
    finally:
        db.close()


def remove_handover(reservation_id: str):
    db = SessionLocal()
    try:
        db.query(Handover).filter(
            Handover.reservation_id == UUID(reservation_id)
        ).delete()
        db.commit()
    finally:
        db.close()


# --- the pure rule --------------------------------------------------------


def test_settle_deposit_takes_charges_first_and_returns_the_rest():
    assert settle_deposit(Decimal("74.00"), Decimal("200.00")) == (
        Decimal("74.00"),
        Decimal("126.00"),
        Decimal("0.00"),
    )


def test_settle_deposit_no_charges_returns_it_all():
    assert settle_deposit(Decimal("0.00"), Decimal("200.00")) == (
        Decimal("0.00"),
        Decimal("200.00"),
        Decimal("0.00"),
    )


def test_settle_deposit_charges_beyond_the_deposit_are_still_due():
    assert settle_deposit(Decimal("320.00"), Decimal("200.00")) == (
        Decimal("200.00"),
        Decimal("0.00"),
        Decimal("120.00"),
    )


# --- configuration --------------------------------------------------------


def test_deposit_amount_is_configurable_and_validated():
    original = client.get("/api/configuration").json()["security_deposit_amount"]

    try:
        ok = client.patch("/api/configuration", json={"security_deposit_amount": 150})
        assert ok.status_code == 200
        assert ok.json()["security_deposit_amount"] == 150

        assert (
            client.patch(
                "/api/configuration", json={"security_deposit_amount": -1}
            ).status_code
            == 422
        )
    finally:
        client.patch("/api/configuration", json={"security_deposit_amount": original})


# --- check-in -------------------------------------------------------------


def test_deposit_cannot_be_taken_when_disabled():
    reservation = confirmed_paid()

    try:
        response = client.post(deposit_url(reservation["id"], "confirm-cash"))

        assert response.status_code == 400
        assert "not enabled" in response.json()["detail"]
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_cash_deposit_needs_the_rental_payment_first(deposit_on):
    base = datetime.now(timezone.utc) + timedelta(days=far_future_days())
    reservation = create_confirmed_reservation(
        "SA-008-AA", base.isoformat(), (base + timedelta(days=1)).isoformat()
    )

    try:
        response = client.post(deposit_url(reservation["id"], "confirm-cash"))

        assert response.status_code == 400
        assert "rental payment" in response.json()["detail"]
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_cash_deposit_is_held_and_audited(deposit_on):
    reservation = confirmed_paid()

    try:
        response = client.post(deposit_url(reservation["id"], "confirm-cash"))

        assert response.status_code == 200
        body = response.json()
        assert body["deposit_status"] == "HELD"
        assert body["deposit_method"] == "CASH"
        assert body["deposit_amount"] == DEPOSIT
        assert body["deposit_held_at"] is not None

        # Once held it can't be taken again.
        again = client.post(deposit_url(reservation["id"], "confirm-cash"))
        assert again.status_code == 400
        assert "already held" in again.json()["detail"]

        db = SessionLocal()
        try:
            rows = (
                db.query(AuditLog)
                .filter(
                    AuditLog.entity_id == UUID(body["id"]),
                    AuditLog.action == "handover.deposit_held",
                )
                .all()
            )
            assert len(rows) == 1
            assert rows[0].details["method"] == "CASH"
        finally:
            db.close()
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_agreement_requires_the_deposit_when_enabled_but_not_when_off():
    reservation = confirmed_paid()
    customer_id = reservation["customer"]["id"]

    client.post(
        f"/api/reservations/{reservation['id']}/handover/signature",
        json={"signature_image": TINY_SIGNATURE},
    )
    _employee_sign(reservation["id"])
    _mark_identity_verified(customer_id)

    original = client.get("/api/configuration").json()["security_deposit_amount"]

    try:
        client.patch("/api/configuration", json={"security_deposit_amount": DEPOSIT})

        blocked = client.post(
            f"/api/reservations/{reservation['id']}/handover/agreement"
        )
        assert blocked.status_code == 400
        assert "security deposit" in blocked.json()["detail"]

        assert (
            client.post(deposit_url(reservation["id"], "confirm-cash")).status_code == 200
        )

        allowed = client.post(
            f"/api/reservations/{reservation['id']}/handover/agreement"
        )
        assert allowed.status_code == 200
    finally:
        client.patch("/api/configuration", json={"security_deposit_amount": original})
        client.patch(
            f"/api/reservations/{reservation['id']}/status",
            json={"status": "COMPLETED"},
        )
        _reset_identity_verification(customer_id)


def test_cancelling_releases_a_held_deposit(deposit_on):
    reservation = confirmed_paid()
    client.post(deposit_url(reservation["id"], "confirm-cash"))

    cancelled = client.patch(f"/api/reservations/{reservation['id']}/cancel")
    assert cancelled.status_code == 200

    handover = handover_row(reservation["id"])
    assert handover.deposit_status == "RELEASED"
    assert handover.deposit_settled_at is not None

    db = SessionLocal()
    try:
        assert (
            db.query(AuditLog)
            .filter(
                AuditLog.entity_id == handover.id,
                AuditLog.action == "handover.deposit_released",
            )
            .count()
            == 1
        )
    finally:
        db.close()


# --- check-out ------------------------------------------------------------


def test_charges_are_taken_from_a_cash_deposit_and_the_rest_handed_back():
    reservation, car = make_active_reservation(hours_late=-1)
    add_held_deposit(reservation["id"])

    try:
        recorded = condition(reservation["id"], fuel_eighths=0).json()
        total = recorded["total_charge"]
        assert total > 0
        assert recorded["deposit_pending"] is True
        assert recorded["deposit_amount"] == DEPOSIT

        # Nothing can be paid, signed or completed until the deposit is settled.
        assert pay_cash(reservation["id"]).status_code == 400
        assert sign(reservation["id"]).status_code == 400
        assert complete(reservation["id"]).status_code == 400

        settled = client.post(
            f"/api/reservations/{reservation['id']}/check-out/settle-deposit"
        )
        assert settled.status_code == 200
        body = settled.json()
        assert body["deposit_applied"] == pytest.approx(total)
        assert body["deposit_returned"] == pytest.approx(DEPOSIT - total)
        assert body["deposit_status"] == "PARTIALLY_CAPTURED"
        assert body["deposit_pending"] is False
        assert body["amount_due"] == 0

        # The deposit covered it all, so nothing more to collect.
        assert pay_cash(reservation["id"]).status_code == 400
        assert sign(reservation["id"]).status_code == 200
        assert complete(reservation["id"]).status_code == 200

        assert "check_out.deposit_settled" in audit_actions(body["id"])
        assert handover_row(reservation["id"]).deposit_captured_amount == Decimal(
            str(total)
        )
    finally:
        cleanup(reservation, car)
        remove_handover(reservation["id"])


def test_no_charges_releases_the_whole_deposit():
    reservation, car = make_active_reservation(hours_late=-1)
    add_held_deposit(reservation["id"])

    try:
        condition(reservation["id"], fuel_eighths=8)

        body = client.post(
            f"/api/reservations/{reservation['id']}/check-out/settle-deposit"
        ).json()

        assert body["deposit_applied"] == 0
        assert body["deposit_returned"] == DEPOSIT
        assert body["deposit_status"] == "RELEASED"

        assert sign(reservation["id"]).status_code == 200
        assert complete(reservation["id"]).status_code == 200
    finally:
        cleanup(reservation, car)
        remove_handover(reservation["id"])


def test_charges_beyond_the_deposit_are_collected_as_usual():
    reservation, car = make_active_reservation(hours_late=-1)
    add_held_deposit(reservation["id"])

    try:
        recorded = condition(
            reservation["id"],
            fuel_eighths=0,
            damage_reported=True,
            damage_notes="Big dent",
            damage_charge=300,
            damage_task_starts_at=datetime.now(timezone.utc).isoformat(),
            damage_task_ends_at=(datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
        ).json()
        total = recorded["total_charge"]

        body = client.post(
            f"/api/reservations/{reservation['id']}/check-out/settle-deposit"
        ).json()

        assert body["deposit_applied"] == DEPOSIT
        assert body["deposit_status"] == "CAPTURED"
        assert body["amount_due"] == pytest.approx(total - DEPOSIT)

        # The rest still has to be paid before signing.
        assert sign(reservation["id"]).status_code == 400
        paid = pay_cash(reservation["id"])
        assert paid.status_code == 200
        assert paid.json()["payment_amount"] == pytest.approx(total - DEPOSIT)

        assert sign(reservation["id"]).status_code == 200

        done = complete(reservation["id"])
        assert done.status_code == 200
        task_id = done.json()["maintenance_task_id"]
        client.patch(f"/api/maintenance/tasks/{task_id}/cancel")
    finally:
        cleanup(reservation, car)
        remove_handover(reservation["id"])


def test_a_waived_charge_is_not_taken_from_the_deposit():
    reservation, car = make_active_reservation(hours_late=-1)
    add_held_deposit(reservation["id"])

    try:
        condition(reservation["id"], fuel_eighths=0)
        waived = client.post(
            f"/api/reservations/{reservation['id']}/check-out/waive",
            json={"waive_fuel_fee": True, "reason": "Pump broken"},
        )
        assert waived.json()["total_charge"] == 0

        body = client.post(
            f"/api/reservations/{reservation['id']}/check-out/settle-deposit"
        ).json()

        assert body["deposit_applied"] == 0
        assert body["deposit_status"] == "RELEASED"
    finally:
        cleanup(reservation, car)
        remove_handover(reservation["id"])


def test_settling_needs_a_held_deposit_and_locks_the_figures():
    reservation, car = make_active_reservation(hours_late=-1)

    try:
        condition(reservation["id"], fuel_eighths=4)

        without = client.post(
            f"/api/reservations/{reservation['id']}/check-out/settle-deposit"
        )
        assert without.status_code == 400
        assert "no security deposit" in without.json()["detail"]

        add_held_deposit(reservation["id"])
        assert (
            client.post(
                f"/api/reservations/{reservation['id']}/check-out/settle-deposit"
            ).status_code
            == 200
        )

        # Settled: the condition can't change and it can't be settled twice.
        assert condition(reservation["id"], fuel_eighths=8).status_code == 400
        assert (
            client.post(
                f"/api/reservations/{reservation['id']}/check-out/settle-deposit"
            ).status_code
            == 400
        )
    finally:
        cleanup(reservation, car)
        remove_handover(reservation["id"])


def test_the_applied_deposit_counts_as_collected_revenue():
    today = datetime.now(timezone.utc).date().isoformat()
    params = {"start_date": today, "end_date": today}
    before = client.get("/api/dashboard/revenue", params=params).json()

    reservation, car = make_active_reservation(hours_late=-1)
    add_held_deposit(reservation["id"])

    try:
        recorded = condition(reservation["id"], fuel_eighths=0).json()
        client.post(f"/api/reservations/{reservation['id']}/check-out/settle-deposit")

        after = client.get("/api/dashboard/revenue", params=params).json()

        assert after["total_collected"] - before["total_collected"] == pytest.approx(
            recorded["total_charge"]
        )
        assert (
            after["collected_by_method"]["cash"]
            - before["collected_by_method"]["cash"]
        ) == pytest.approx(recorded["total_charge"])
    finally:
        cleanup(reservation, car)
        remove_handover(reservation["id"])


def test_a_rental_without_a_deposit_checks_out_as_before():
    reservation, car = make_active_reservation(hours_late=-1)

    try:
        recorded = condition(reservation["id"], fuel_eighths=8).json()

        assert recorded["deposit_pending"] is False
        assert recorded["deposit_held"] is False
        assert recorded["amount_due"] == 0
        assert sign(reservation["id"]).status_code == 200
        assert complete(reservation["id"]).status_code == 200
    finally:
        cleanup(reservation, car)


def test_customer_export_lists_the_deposit():
    reservation, car = make_active_reservation(hours_late=-1)
    add_held_deposit(reservation["id"])

    try:
        condition(reservation["id"], fuel_eighths=8)
        client.post(f"/api/reservations/{reservation['id']}/check-out/settle-deposit")
        sign(reservation["id"])
        complete(reservation["id"])

        export = client.get(f"/api/customers/{reservation['customer_id']}/export").json()
        (row,) = [r for r in export["reservations"] if r["id"] == reservation["id"]]

        assert row["deposit_status"] == "RELEASED"
        assert row["deposit_amount"] == DEPOSIT
        assert row["deposit_captured_amount"] == 0
    finally:
        cleanup(reservation, car)
        remove_handover(reservation["id"])


# --- card ----------------------------------------------------------------


@requires_stripe
def test_card_deposit_is_an_authorization_held_then_partly_captured(deposit_on):
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    reservation = confirmed_paid(day=7)

    intent = client.post(deposit_url(reservation["id"], "intent"))
    assert intent.status_code == 200
    intent_id = intent.json()["client_secret"].split("_secret")[0]

    stripe.PaymentIntent.confirm(intent_id, payment_method="pm_card_visa")
    assert stripe.PaymentIntent.retrieve(intent_id).status == "requires_capture"

    held = client.post(deposit_url(reservation["id"], "confirm"))
    assert held.status_code == 200
    assert held.json()["deposit_status"] == "HELD"
    assert held.json()["deposit_method"] == "CARD"

    # Start the rental directly, then check it out.
    db = SessionLocal()
    try:
        row = db.get(Reservation, UUID(reservation["id"]))
        now = datetime.now(timezone.utc)
        row.pickup_at = now - timedelta(days=1)
        row.return_at = now + timedelta(hours=1)
        row.status = "ACTIVE"
        db.get(Car, row.car_id).status = "RENTED"
        db.commit()
    finally:
        db.close()

    car = client.get(f"/api/cars/{reservation['car']['id']}").json()

    try:
        recorded = condition(reservation["id"], fuel_eighths=0).json()

        settled = client.post(
            f"/api/reservations/{reservation['id']}/check-out/settle-deposit"
        )
        assert settled.status_code == 200
        assert settled.json()["deposit_status"] == "PARTIALLY_CAPTURED"

        stripe_intent = stripe.PaymentIntent.retrieve(intent_id)
        assert stripe_intent.status == "succeeded"
        assert stripe_intent.amount_received == int(round(recorded["total_charge"] * 100))
    finally:
        cleanup(reservation, car)
