"""
check_reservation_overlaps.py is what an operator runs before the no-overlap
migration. It has to find an overlap when there is one and stay quiet when
there is not, so the database's own rule is lifted inside a transaction that is
rolled back, to be able to create one.
"""

from datetime import timedelta

import pytest
from sqlalchemy import select, text

from app.database import SessionLocal
from app.models import Car, Customer, Location, Reservation
from check_reservation_overlaps import OVERLAPS
from tests.test_database_constraints import _reservation, _window


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.rollback()
    session.close()


def _setup(db):
    car = db.scalars(select(Car).limit(1)).first()
    customer = db.scalars(select(Customer).limit(1)).first()
    location = db.get(Location, car.current_location_id)

    # Lifted only for this transaction; the rollback puts it back.
    db.execute(text("ALTER TABLE reservations DROP CONSTRAINT no_overlapping_active_reservations"))

    return car, customer, location


def test_it_finds_two_active_reservations_that_overlap(db):
    car, customer, location = _setup(db)
    start = _window()

    first = _reservation(db, car, customer, location, start, 48)
    second = _reservation(db, car, customer, location, start + timedelta(hours=24), 48, status="ACTIVE")

    found = [row for row in db.execute(OVERLAPS).all() if row[1] in (first.id, second.id)]

    assert len(found) == 1
    assert found[0][0] == car.license_plate
    assert {found[0][1], found[0][5]} == {first.id, second.id}


def test_it_ignores_back_to_back_inactive_and_other_cars(db):
    car, customer, location = _setup(db)
    start = _window()
    other = db.scalars(select(Car).where(Car.id != car.id).limit(1)).first()

    mine = [
        _reservation(db, car, customer, location, start, 24),
        _reservation(db, car, customer, location, start + timedelta(hours=24), 24),
        _reservation(db, car, customer, location, start, 48, status="PENDING"),
        _reservation(db, car, customer, location, start, 48, status="CANCELLED"),
        _reservation(db, other, customer, location, start, 48),
    ]
    ids = {reservation.id for reservation in mine}

    assert [row for row in db.execute(OVERLAPS).all() if row[1] in ids or row[5] in ids] == []
