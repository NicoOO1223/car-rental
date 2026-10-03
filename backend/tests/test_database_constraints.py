"""
The rules the application keeps are also kept by the database, so a path that
forgets one (a script, a new endpoint, a hand-run UPDATE) gets an error instead
of bad data. These tests write around the application on purpose.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models import Car, Configuration, Customer, Handover, Location, Reservation
from tests._dates import far_future_days

OVERLAP = "no_overlapping_active_reservations"


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.rollback()
    session.close()


def _refused(db, constraint: str):
    """The statement that follows must fail on this constraint."""

    class _Expect:
        def __enter__(self):
            return self

        def __exit__(self, kind, error, traceback):
            if kind is None:
                raise AssertionError(f"the database accepted what {constraint} forbids")

            if not issubclass(kind, IntegrityError):
                return False

            assert constraint in str(error.orig), str(error.orig)
            db.rollback()

            return True

    return _Expect()


def _reservation(db, car, customer, location, pickup, hours, status="CONFIRMED") -> Reservation:
    reservation = Reservation(
        customer_id=customer.id,
        car_id=car.id,
        pickup_location_id=location.id,
        return_location_id=location.id,
        pickup_at=pickup,
        return_at=pickup + timedelta(hours=hours),
        status=status,
    )
    db.add(reservation)
    db.flush()

    return reservation


def _fixtures(db):
    car = db.scalars(select(Car).limit(1)).first()
    customer = db.scalars(select(Customer).limit(1)).first()
    location = db.get(Location, car.current_location_id)

    return car, customer, location


def _window():
    return datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=far_future_days())


def test_two_active_reservations_cannot_overlap_on_one_car(db):
    car, customer, location = _fixtures(db)
    start = _window()

    _reservation(db, car, customer, location, start, 48)

    with _refused(db, OVERLAP):
        _reservation(db, car, customer, location, start + timedelta(hours=24), 48, status="ACTIVE")


def test_back_to_back_and_inactive_reservations_are_allowed(db):
    car, customer, location = _fixtures(db)
    start = _window()

    _reservation(db, car, customer, location, start, 24)

    # The next renter can take the car the moment it is due back.
    _reservation(db, car, customer, location, start + timedelta(hours=24), 24)

    # A request, a cancelled booking and a finished one do not hold the car.
    for status in ("PENDING", "CANCELLED", "COMPLETED", "EXPIRED", "AWAITING_PAYMENT"):
        _reservation(db, car, customer, location, start, 48, status=status)

    # Another car at the same time is not a conflict.
    other = db.scalars(select(Car).where(Car.id != car.id).limit(1)).first()
    _reservation(db, other, customer, location, start, 48)


def test_a_booking_cannot_be_moved_onto_another_active_one(db):
    car, customer, location = _fixtures(db)
    start = _window()

    _reservation(db, car, customer, location, start, 24)
    later = _reservation(db, car, customer, location, start + timedelta(days=5), 24)

    with _refused(db, OVERLAP):
        db.execute(
            update(Reservation)
            .where(Reservation.id == later.id)
            .values(pickup_at=start + timedelta(hours=12), return_at=start + timedelta(hours=36))
        )
        db.flush()


def test_a_pending_request_cannot_be_confirmed_over_an_active_booking(db):
    car, customer, location = _fixtures(db)
    start = _window()

    _reservation(db, car, customer, location, start, 24)
    request = _reservation(db, car, customer, location, start, 24, status="PENDING")

    with _refused(db, OVERLAP):
        db.execute(update(Reservation).where(Reservation.id == request.id).values(status="CONFIRMED"))
        db.flush()


def test_a_reservation_status_has_to_be_a_known_one(db):
    car, customer, location = _fixtures(db)

    with _refused(db, "valid_reservation_status"):
        _reservation(db, car, customer, location, _window(), 24, status="DONE")


def test_a_car_status_has_to_be_a_known_one(db):
    car = db.scalars(select(Car).limit(1)).first()

    with _refused(db, "valid_car_status"):
        db.execute(update(Car).where(Car.id == car.id).values(status="RESERVED"))
        db.flush()


@pytest.mark.parametrize(
    ("model", "column", "constraint"),
    [
        (Car, "price_per_day", "cars_price_per_day_not_negative"),
        (Configuration, "late_fee_per_hour", "configuration_late_fee_per_hour_not_negative"),
        (Configuration, "vat_rate", "configuration_vat_rate_is_a_percentage"),
        (Handover, "payment_amount", "handovers_payment_amount_not_negative"),
        (Reservation, "agreed_total_amount", "reservations_agreed_total_amount_not_negative"),
    ],
)
def test_money_cannot_be_negative_and_a_vat_rate_is_a_percentage(db, model, column, constraint):
    row = db.scalars(select(model).limit(1)).first()

    if row is None:
        # Not every table has a row in a fresh database; give a handover a home.
        car, customer, location = _fixtures(db)
        reservation = _reservation(db, car, customer, location, _window(), 24)
        row = Handover(reservation_id=reservation.id)
        db.add(row)
        db.flush()

    bad = Decimal("150") if column == "vat_rate" else Decimal("-0.01")

    with _refused(db, constraint):
        db.execute(update(model).where(model.id == row.id).values({column: bad}))
        db.flush()


def test_an_overlap_that_slips_past_the_application_is_a_clear_message():
    # The application checks first; this is what a request that raced past the
    # check gets back instead of a server error.
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.error_handlers import install_error_handlers

    net = FastAPI()
    install_error_handlers(net)

    @net.get("/book")
    def book():
        session = SessionLocal()
        try:
            car, customer, location = _fixtures(session)
            start = _window()
            _reservation(session, car, customer, location, start, 24)
            _reservation(session, car, customer, location, start, 24)
        finally:
            session.rollback()
            session.close()

    response = TestClient(net).get("/book")

    assert response.status_code == 400
    assert response.json()["code"] == "reservation.car_already_reserved_part_period"
