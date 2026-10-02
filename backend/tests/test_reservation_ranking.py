"""
Ranks reservations competing for the same car and dates: a repeat customer
outranks a new one, then a higher agreed price, then whoever asked first —
a plain priority order, not a weighted score (see
app/services/reservation_ranking.py).
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import User
from app.schemas.reservation import CustomerCreate
from app.services.reservation_ranking import is_repeat_customer, rank_overlap_candidates
from app.services.reservations import create_reservation
from tests._dates import far_future_days
from tests.test_reservations import ensure_car_available, get_location_id

client = TestClient(app)


def _actor(db):
    return db.scalars(select(User)).first()


def _customer(label):
    return CustomerCreate(
        first_name="Rank",
        last_name=label,
        date_of_birth="1990-01-01",
        address="Rank Street 1",
        postal_code="0001",
        phone_number="+390000000001",
        email=f"rank.{label}@example.com",
    )


def _window(days=2):
    pickup = datetime.now(timezone.utc) + timedelta(days=far_future_days())

    return pickup, pickup + timedelta(days=days)


def test_a_repeat_customer_outranks_a_new_one():
    car = ensure_car_available("SA-004-AA")
    car_id = UUID(car["id"])
    location_id = UUID(get_location_id("CAG"))

    db = SessionLocal()

    try:
        # "loyal" has a completed rental already, in a separate time slot.
        past_pickup, past_dropoff = _window()
        prior = create_reservation(
            db, _customer("loyal"), car_id, location_id, location_id, past_pickup, past_dropoff, actor=_actor(db)
        )
        prior.status = "COMPLETED"
        db.commit()

        pickup, dropoff = _window()
        loyal = create_reservation(
            db, _customer("loyal"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(db)
        )
        new = create_reservation(
            db, _customer("new"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(db)
        )

        assert is_repeat_customer(db, loyal.customer_id) is True
        assert is_repeat_customer(db, new.customer_id) is False

        ranked, meta = rank_overlap_candidates(db, [new, loyal])

        assert [r.id for r in ranked] == [loyal.id, new.id]
        assert meta["suggested_id"] == loyal.id
        # "loyal" was also requested first, so both genuinely apply here.
        assert meta["suggested_reasons"] == ["repeat_customer", "requested_first"]
    finally:
        db.close()
        client.patch(f"/api/reservations/{loyal.id}/cancel")
        client.patch(f"/api/reservations/{new.id}/cancel")


def test_higher_value_wins_among_equally_new_customers():
    car = ensure_car_available("SA-004-AA")
    car_id = UUID(car["id"])
    location_id = UUID(get_location_id("CAG"))
    pickup, dropoff = _window()

    db = SessionLocal()

    try:
        cheaper = create_reservation(
            db, _customer("cheaper"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(db)
        )
        pricier = create_reservation(
            db, _customer("pricier"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(db)
        )

        # Explicit, deterministic values rather than relying on indirect
        # pricing rules to produce two different amounts.
        cheaper.agreed_total_amount = Decimal("100.00")
        pricier.agreed_total_amount = Decimal("500.00")
        db.commit()

        ranked, meta = rank_overlap_candidates(db, [cheaper, pricier])

        assert [r.id for r in ranked] == [pricier.id, cheaper.id]
        assert meta["suggested_id"] == pricier.id
        assert meta["suggested_reasons"] == ["highest_value"]
    finally:
        db.close()
        client.patch(f"/api/reservations/{cheaper.id}/cancel")
        client.patch(f"/api/reservations/{pricier.id}/cancel")


def test_earliest_request_wins_when_everything_else_ties():
    car = ensure_car_available("SA-004-AA")
    car_id = UUID(car["id"])
    location_id = UUID(get_location_id("CAG"))
    pickup, dropoff = _window()

    db = SessionLocal()

    try:
        first = create_reservation(
            db, _customer("first"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(db)
        )
        second = create_reservation(
            db, _customer("second"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(db)
        )

        # Same amount for both, so request time is the only tie-breaker left.
        first.agreed_total_amount = Decimal("200.00")
        second.agreed_total_amount = Decimal("200.00")
        db.commit()

        assert first.created_at < second.created_at

        ranked, meta = rank_overlap_candidates(db, [second, first])

        assert [r.id for r in ranked] == [first.id, second.id]
        assert meta["suggested_id"] == first.id
        assert meta["suggested_reasons"] == ["requested_first"]
    finally:
        db.close()
        client.patch(f"/api/reservations/{first.id}/cancel")
        client.patch(f"/api/reservations/{second.id}/cancel")


def test_reasons_omit_criteria_that_do_not_distinguish_the_winner():
    car = ensure_car_available("SA-004-AA")
    car_id = UUID(car["id"])
    location_id = UUID(get_location_id("CAG"))
    pickup, dropoff = _window()

    db = SessionLocal()

    try:
        a = create_reservation(
            db, _customer("a"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(db)
        )
        b = create_reservation(
            db, _customer("b"), car_id, location_id, location_id, pickup, dropoff, actor=_actor(db)
        )

        # Neither is a repeat customer, and both tie on value — only request
        # order actually distinguishes them, so "highest_value" must not be
        # claimed by the winner.
        a.agreed_total_amount = Decimal("300.00")
        b.agreed_total_amount = Decimal("300.00")
        db.commit()

        ranked, meta = rank_overlap_candidates(db, [a, b])

        assert meta["suggested_id"] == a.id
        assert meta["suggested_reasons"] == ["requested_first"]
    finally:
        db.close()
        client.patch(f"/api/reservations/{a.id}/cancel")
        client.patch(f"/api/reservations/{b.id}/cancel")


def test_empty_list_has_no_suggestion():
    db = SessionLocal()

    try:
        ranked, meta = rank_overlap_candidates(db, [])

        assert ranked == []
        assert meta == {"suggested_id": None, "suggested_reasons": []}
    finally:
        db.close()
