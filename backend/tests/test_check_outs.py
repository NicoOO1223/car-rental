import os
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
import stripe
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import AuditLog, Car, Reservation
from tests.test_handovers import TINY_SIGNATURE
from tests.test_reservations import (
    create_reservation,
    ensure_car_available,
    get_location_id,
    set_car_location,
    set_car_status,
)

client = TestClient(app)

PLATE = "SA-002-AA"  # home: OLB

requires_stripe = pytest.mark.skipif(
    not os.getenv("STRIPE_SECRET_KEY"),
    reason="STRIPE_SECRET_KEY not configured in this environment.",
)


def configuration() -> dict:
    return client.get("/api/configuration").json()


def make_active_reservation(
    hours_late: float = 0,
    return_location_code: str | None = None,
) -> tuple[dict, dict]:
    """
    An ACTIVE rental of PLATE whose scheduled return was `hours_late` hours
    ago (negative: in the future). Created far ahead to avoid clashing with
    other tests, then moved to the present directly in the database, since
    the API has no way to start a rental without the whole handover.
    Returns (reservation, car).
    """

    car = ensure_car_available(PLATE)
    location_id = car["current_location"]["id"]
    base = datetime.now(timezone.utc) + timedelta(days=900 + random.randint(0, 3000))

    payload_customer = {
        "first_name": "Return",
        "last_name": f"Test{uuid4().hex[:6]}",
        "date_of_birth": "1990-01-01",
        "address": "Return Street 1",
        "postal_code": "1000AA",
        "phone_number": f"+3165{uuid4().int % 10**7:07d}",
        "email": f"return.{uuid4().hex[:8]}@example.com",
    }

    response = client.post(
        "/api/reservations",
        json={
            "customer": payload_customer,
            "car_id": car["id"],
            "pickup_location_id": location_id,
            "return_location_id": (
                get_location_id(return_location_code)
                if return_location_code
                else location_id
            ),
            "pickup_at": base.isoformat(),
            "return_at": (base + timedelta(days=2)).isoformat(),
        },
    )
    assert response.status_code == 201
    reservation = response.json()

    now = datetime.now(timezone.utc)
    return_at = now - timedelta(hours=hours_late)

    db = SessionLocal()
    try:
        row = db.get(Reservation, UUID(reservation["id"]))
        row.pickup_at = return_at - timedelta(days=2)
        row.return_at = return_at
        row.status = "ACTIVE"
        db.get(Car, UUID(car["id"])).status = "RENTED"
        db.commit()
    finally:
        db.close()

    return reservation, car


def cleanup(reservation: dict, car: dict) -> None:
    db = SessionLocal()
    try:
        row = db.get(Reservation, UUID(reservation["id"]))
        if row.status in ("ACTIVE", "CONFIRMED", "PENDING"):
            row.status = "CANCELLED"
        db.commit()
    finally:
        db.close()

    set_car_location(car["id"], car["home_location"]["id"])
    set_car_status(car["id"], "AVAILABLE")

    db = SessionLocal()
    try:
        db.get(Car, UUID(car["id"])).mileage = car["mileage"]
        db.commit()
    finally:
        db.close()


def condition(reservation_id: str, **overrides):
    payload = {
        "return_mileage": 50_000,
        "fuel_eighths": 8,
        "damage_reported": False,
    }
    payload.update(overrides)

    return client.post(
        f"/api/reservations/{reservation_id}/check-out/condition", json=payload
    )


def sign(reservation_id: str):
    return client.post(
        f"/api/reservations/{reservation_id}/check-out/employee-signature",
        json={"signature_image": TINY_SIGNATURE},
    )


def pay_cash(reservation_id: str):
    return client.post(
        f"/api/reservations/{reservation_id}/check-out/confirm-cash-payment"
    )


def complete(reservation_id: str):
    return client.post(f"/api/reservations/{reservation_id}/check-out/complete")


def audit_actions(check_out_id: str) -> list[str]:
    db = SessionLocal()
    try:
        return [
            row.action
            for row in db.query(AuditLog)
            .filter(
                AuditLog.entity_type == "check_out",
                AuditLog.entity_id == UUID(check_out_id),
            )
            .order_by(AuditLog.created_at)
        ]
    finally:
        db.close()


def test_check_out_is_null_until_started_and_404_for_unknown_reservation():
    reservation, car = make_active_reservation()

    try:
        response = client.get(f"/api/reservations/{reservation['id']}/check-out")
        assert response.status_code == 200
        assert response.json() is None

        assert client.get(f"/api/reservations/{uuid4()}/check-out").status_code == 404
    finally:
        cleanup(reservation, car)


def test_only_an_active_rental_can_be_checked_out():
    car = ensure_car_available(PLATE)
    base = datetime.now(timezone.utc) + timedelta(days=5000 + random.randint(0, 500))
    reservation = create_reservation(
        car["id"],
        car["current_location"]["id"],
        base.isoformat(),
        (base + timedelta(days=1)).isoformat(),
    )

    try:
        response = condition(reservation["id"])

        assert response.status_code == 400
        assert "out with the customer" in response.json()["detail"]
    finally:
        client.patch(f"/api/reservations/{reservation['id']}/cancel")


def test_condition_validation():
    reservation, car = make_active_reservation()

    try:
        assert condition(reservation["id"], return_mileage=-5).status_code == 400
        assert condition(reservation["id"], fuel_eighths=9).status_code == 400

        no_notes = condition(reservation["id"], damage_reported=True)
        assert no_notes.status_code == 400
        assert "Describe the damage" in no_notes.json()["detail"]

        charge_without_damage = condition(reservation["id"], damage_charge=50)
        assert charge_without_damage.status_code == 400

        too_much = condition(
            reservation["id"],
            damage_reported=True,
            damage_notes="Dent",
            damage_charge=configuration()["max_damage_charge"] + 1,
            damage_task_starts_at=datetime.now(timezone.utc).isoformat(),
            damage_task_ends_at=(datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        )
        assert too_much.status_code == 400
        assert "maximum" in too_much.json()["detail"]
    finally:
        cleanup(reservation, car)


def test_mileage_cannot_be_lower_than_the_cars_recorded_mileage():
    reservation, car = make_active_reservation()

    db = SessionLocal()
    try:
        db.get(Car, UUID(car["id"])).mileage = 70_000
        db.commit()
    finally:
        db.close()

    try:
        response = condition(reservation["id"], return_mileage=69_000)

        assert response.status_code == 400
        assert "70000" in response.json()["detail"]
    finally:
        db = SessionLocal()
        try:
            db.get(Car, UUID(car["id"])).mileage = None
            db.commit()
        finally:
            db.close()
        cleanup(reservation, car)


def test_on_time_full_tank_check_out_has_no_charges_and_completes():
    reservation, car = make_active_reservation(hours_late=-2)

    try:
        recorded = condition(reservation["id"], return_mileage=51_234)
        assert recorded.status_code == 200, recorded.text
        body = recorded.json()
        assert body["late_hours"] == 0
        assert body["total_charge"] == 0

        # Nothing to collect.
        assert pay_cash(reservation["id"]).status_code == 400

        # The signature comes before completing, and completing needs it.
        assert complete(reservation["id"]).status_code == 400
        assert sign(reservation["id"]).status_code == 200

        done = complete(reservation["id"])
        assert done.status_code == 200
        assert done.json()["car_away_from_home"] is False
        assert done.json()["maintenance_task_id"] is None

        after = client.get(f"/api/reservations/{reservation['id']}").json()
        assert after["status"] == "COMPLETED"

        car_after = client.get(f"/api/cars/{car['id']}").json()
        assert car_after["status"] == "AVAILABLE"
        assert car_after["mileage"] == 51_234

        assert audit_actions(body["id"]) == [
            "check_out.condition_recorded",
            "check_out.employee_signed",
            "check_out.completed",
        ]

        # A completed check-out is closed.
        assert condition(reservation["id"]).status_code == 400
    finally:
        cleanup(reservation, car)


def test_late_and_low_fuel_are_charged_from_configuration():
    reservation, car = make_active_reservation(hours_late=5)
    config = configuration()

    try:
        body = condition(reservation["id"], fuel_eighths=3).json()

        late_hours = 5  # 5h late, past the grace period, counted from schedule
        expected_late = round(late_hours * config["late_fee_per_hour"], 2)
        expected_fuel = round(5 * config["fuel_fee_per_eighth"] + config["refuel_service_fee"], 2)

        assert body["late_hours"] in (late_hours, late_hours + 1)  # clock ticks
        assert body["late_fee"] == pytest.approx(body["late_hours"] * config["late_fee_per_hour"])
        assert body["late_fee"] >= expected_late
        assert body["fuel_fee"] == pytest.approx(expected_fuel)
        assert body["total_charge"] == pytest.approx(body["late_fee"] + body["fuel_fee"])
    finally:
        cleanup(reservation, car)


def test_charges_must_be_paid_before_signing_and_completing():
    reservation, car = make_active_reservation(hours_late=-1)

    try:
        assert condition(reservation["id"], fuel_eighths=4).status_code == 200

        assert sign(reservation["id"]).status_code == 400
        assert complete(reservation["id"]).status_code == 400

        paid = pay_cash(reservation["id"])
        assert paid.status_code == 200
        assert paid.json()["payment_status"] == "SUCCEEDED"
        assert paid.json()["payment_method"] == "CASH"
        assert paid.json()["payment_amount"] == paid.json()["total_charge"]

        assert sign(reservation["id"]).status_code == 200
        assert complete(reservation["id"]).status_code == 200
    finally:
        cleanup(reservation, car)


def test_waiving_requires_a_reason_and_is_audited():
    reservation, car = make_active_reservation(hours_late=-1)

    try:
        recorded = condition(reservation["id"], fuel_eighths=0).json()
        assert recorded["fuel_fee"] > 0

        url = f"/api/reservations/{reservation['id']}/check-out/waive"

        no_reason = client.post(url, json={"waive_fuel_fee": True})
        assert no_reason.status_code == 400

        nothing_to_waive = client.post(
            url, json={"waive_late_fee": True, "reason": "Goodwill"}
        )
        assert nothing_to_waive.status_code == 400
        assert "no late fee" in nothing_to_waive.json()["detail"]

        waived = client.post(
            url, json={"waive_fuel_fee": True, "reason": "Pump was broken"}
        )
        assert waived.status_code == 200
        assert waived.json()["total_charge"] == 0
        assert waived.json()["waiver_reason"] == "Pump was broken"

        assert "check_out.charge_waived" in audit_actions(recorded["id"])

        # Nothing to pay now, so the employee can sign and complete.
        assert sign(reservation["id"]).status_code == 200
        assert complete(reservation["id"]).status_code == 200
    finally:
        cleanup(reservation, car)


def test_figures_are_locked_once_paid():
    reservation, car = make_active_reservation(hours_late=-1)

    try:
        condition(reservation["id"], fuel_eighths=2)
        assert pay_cash(reservation["id"]).status_code == 200

        assert condition(reservation["id"], fuel_eighths=8).status_code == 400
        assert (
            client.post(
                f"/api/reservations/{reservation['id']}/check-out/waive",
                json={"waive_fuel_fee": True, "reason": "x"},
            ).status_code
            == 400
        )
    finally:
        cleanup(reservation, car)


def test_condition_can_be_corrected_before_payment_and_keeps_the_return_time():
    reservation, car = make_active_reservation(hours_late=-1)

    try:
        first = condition(reservation["id"], fuel_eighths=2).json()
        second = condition(reservation["id"], fuel_eighths=8).json()

        assert second["id"] == first["id"]
        assert second["returned_at"] == first["returned_at"]
        assert second["fuel_fee"] == 0
    finally:
        cleanup(reservation, car)


def test_one_way_return_moves_the_car_and_flags_it_away_from_home():
    reservation, car = make_active_reservation(
        hours_late=-1, return_location_code="AHO"
    )

    try:
        condition(reservation["id"])
        sign(reservation["id"])
        done = complete(reservation["id"]).json()

        assert done["car_away_from_home"] is True
        assert done["car_current_airport_code"] == "AHO"
        assert done["car_home_airport_code"] == "OLB"

        car_after = client.get(f"/api/cars/{car['id']}").json()
        assert car_after["current_location"]["airport_code"] == "AHO"
        assert car_after["is_away_from_home"] is True
    finally:
        cleanup(reservation, car)


def test_reported_damage_opens_a_repair_task_on_completion():
    reservation, car = make_active_reservation(hours_late=-1)
    starts = datetime.now(timezone.utc)
    ends = starts + timedelta(days=3)

    try:
        recorded = condition(
            reservation["id"],
            damage_reported=True,
            damage_notes="Scratch on the rear bumper",
            damage_charge=120,
            damage_task_starts_at=starts.isoformat(),
            damage_task_ends_at=ends.isoformat(),
        )
        assert recorded.status_code == 200, recorded.text
        assert recorded.json()["total_charge"] == 120

        assert pay_cash(reservation["id"]).status_code == 200
        assert sign(reservation["id"]).status_code == 200

        done = complete(reservation["id"])
        assert done.status_code == 200
        task_id = done.json()["maintenance_task_id"]
        assert task_id is not None

        tasks = client.get(
            "/api/maintenance/tasks", params={"status": "OPEN"}
        ).json()["items"]
        task = next(t for t in tasks if t["id"] == task_id)
        assert task["category"] == "DAMAGE_REPAIR"
        assert task["notes"] == "Scratch on the rear bumper"

        # The car is out of service for the repair window.
        car_after = client.get(f"/api/cars/{car['id']}").json()
        assert car_after["status"] == "MAINTENANCE"

        client.patch(f"/api/maintenance/tasks/{task_id}/cancel")
    finally:
        cleanup(reservation, car)


def test_repair_window_clash_is_rejected_when_recording_the_condition():
    reservation, car = make_active_reservation(hours_late=-1)
    starts = datetime.now(timezone.utc)
    ends = starts + timedelta(days=3)

    blocker = client.post(
        "/api/maintenance/tasks",
        json={
            "car_id": car["id"],
            "task_type": "CLEANING",
            "category": None,
            "notes": None,
            "starts_at": (starts + timedelta(days=1)).isoformat(),
            "ends_at": (starts + timedelta(days=2)).isoformat(),
        },
    )
    assert blocker.status_code == 200

    try:
        response = condition(
            reservation["id"],
            damage_reported=True,
            damage_notes="Cracked mirror",
            damage_task_starts_at=starts.isoformat(),
            damage_task_ends_at=ends.isoformat(),
        )

        assert response.status_code == 400
        assert "maintenance or cleaning" in response.json()["detail"]
    finally:
        client.patch(f"/api/maintenance/tasks/{blocker.json()['id']}/cancel")
        cleanup(reservation, car)


@requires_stripe
def test_card_payment_of_charges_confirms_against_stripe():
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

    reservation, car = make_active_reservation(hours_late=-1)

    try:
        condition(reservation["id"], fuel_eighths=1)

        intent = client.post(
            f"/api/reservations/{reservation['id']}/check-out/payment-intent"
        )
        assert intent.status_code == 200
        intent_id = intent.json()["client_secret"].split("_secret")[0]

        stripe.PaymentIntent.confirm(intent_id, payment_method="pm_card_visa")

        confirmed = client.post(
            f"/api/reservations/{reservation['id']}/check-out/confirm-payment"
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["payment_status"] == "SUCCEEDED"
        assert confirmed.json()["payment_method"] == "CARD"

        assert sign(reservation["id"]).status_code == 200
        assert complete(reservation["id"]).status_code == 200
    finally:
        cleanup(reservation, car)


def test_check_out_cash_payments_count_as_collected_revenue():
    today = datetime.now(timezone.utc).date().isoformat()
    params = {"start_date": today, "end_date": today}

    before = client.get("/api/dashboard/revenue", params=params).json()

    reservation, car = make_active_reservation(hours_late=-1)

    try:
        recorded = condition(reservation["id"], fuel_eighths=0).json()
        assert pay_cash(reservation["id"]).status_code == 200

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


def test_overdue_active_rental_stays_in_the_dashboards_next_returns():
    reservation, car = make_active_reservation(hours_late=5)

    try:
        returns = client.get("/api/dashboard").json()["upcoming_returns"]

        assert reservation["id"] in {r["id"] for r in returns}
    finally:
        cleanup(reservation, car)


def test_customer_export_lists_check_out_charges():
    reservation, car = make_active_reservation(hours_late=-1)

    try:
        condition(reservation["id"], fuel_eighths=0)
        pay_cash(reservation["id"])
        sign(reservation["id"])
        complete(reservation["id"])

        export = client.get(
            f"/api/customers/{reservation['customer_id']}/export"
        ).json()

        (row,) = [r for r in export["reservations"] if r["id"] == reservation["id"]]
        assert row["check_out_completed"] is True
        assert row["check_out_total_charge"] > 0
        assert row["check_out_payment_status"] == "SUCCEEDED"
    finally:
        cleanup(reservation, car)
