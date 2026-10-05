"""
Choosing the car for a booking made for a class.

A booking for a class holds a real car right away, so every existing rule (one car,
one booking at a time; the car is where the pickup is; no maintenance in the way)
works unchanged. The car is only provisional (Reservation.car_confirmed is false):
the renter was promised a class, and staff, or the system, may swap it for another car
in the class until a person confirms it or the car is handed over.

Two things keep the class from filling up badly:
  * best fit: of the free cars, take the one the booking leaves the smallest gaps
    around, so long free stretches stay whole for longer rentals;
  * rebalancing: when no car is free but a provisional booking on one is in the way,
    move that booking to another free car. One move at a time, and only a booking
    that starts and ends at the same place, so no car's chain of locations changes.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Car, Reservation
from app.services.availability import (
    blocking_end,
    blocking_reservation_clause,
    has_conflicting_maintenance,
    has_conflicting_reservation,
    lock_car,
    projected_location_id,
)

# A gap longer than this counts as this long: a car free for a month and one free for a year are alike.
GAP_CAP = timedelta(days=30)


def class_cars(db: Session, class_id: UUID, *, online_only: bool = False) -> list[Car]:
    """The cars of a class that are in the fleet, in id order (the order cars are locked in)."""

    query = select(Car).where(Car.class_id == class_id, Car.retired_at.is_(None)).order_by(Car.id)

    if online_only:
        query = query.where(Car.offered_online.is_(True))

    return list(db.scalars(query))


def _is_free(db: Session, car: Car, pickup_location_id, pickup_at, return_at, exclude_reservation_id=None) -> bool:
    return (
        projected_location_id(db, car, pickup_at) == pickup_location_id
        and not has_conflicting_reservation(db, car.id, pickup_at, return_at, exclude_reservation_id)
        and not has_conflicting_maintenance(db, car.id, pickup_at, return_at)
    )


def _leftover(db: Session, car: Car, pickup_at, return_at, exclude_reservation_id=None) -> timedelta:
    """The free time the booking would leave on either side of it on this car (smaller = tighter fit)."""

    others = [Reservation.id != exclude_reservation_id] if exclude_reservation_id is not None else []

    previous_end = db.scalar(
        select(blocking_end())
        .where(Reservation.car_id == car.id, blocking_reservation_clause(), Reservation.return_at <= pickup_at, *others)
        .order_by(Reservation.return_at.desc())
        .limit(1)
    )
    next_start = db.scalar(
        select(Reservation.pickup_at)
        .where(Reservation.car_id == car.id, blocking_reservation_clause(), Reservation.pickup_at >= return_at, *others)
        .order_by(Reservation.pickup_at)
        .limit(1)
    )

    before = min(pickup_at - previous_end, GAP_CAP) if previous_end is not None else GAP_CAP
    after = min(next_start - return_at, GAP_CAP) if next_start is not None else GAP_CAP

    return before + after


def pick_car_for_class(
    db: Session,
    class_id: UUID,
    pickup_location_id,
    pickup_at: datetime,
    return_at: datetime,
    *,
    online_only: bool = False,
    exclude_reservation_id=None,
    rebalance: bool = True,
) -> Car | None:
    """A free car of the class for this period, or None. Locks every car of the class (in
    id order, so two requests cannot wait on each other), then decides."""

    cars = class_cars(db, class_id, online_only=online_only)

    for car in cars:
        lock_car(db, car.id)

    free = [car for car in cars if _is_free(db, car, pickup_location_id, pickup_at, return_at, exclude_reservation_id)]

    if free:
        return min(free, key=lambda car: (_leftover(db, car, pickup_at, return_at, exclude_reservation_id), car.license_plate))

    if not rebalance:
        return None

    return _make_room(db, cars, pickup_location_id, pickup_at, return_at, exclude_reservation_id)


def _movable(db: Session, car: Car, pickup_at, return_at, exclude_reservation_id=None) -> list[Reservation]:
    """Provisional bookings on the car, in the way of this period, that may be moved."""

    now = datetime.now(timezone.utc)

    return list(
        db.scalars(
            select(Reservation).where(
                Reservation.car_id == car.id,
                blocking_reservation_clause(),
                Reservation.status.in_(("CONFIRMED", "AWAITING_PAYMENT")),
                Reservation.car_confirmed.is_(False),
                Reservation.pickup_location_id == Reservation.return_location_id,
                Reservation.pickup_at > now,
                Reservation.pickup_at < return_at,
                blocking_end() > pickup_at,
                Reservation.id != exclude_reservation_id if exclude_reservation_id is not None else True,
            )
        )
    )


def _make_room(db: Session, cars: list[Car], pickup_location_id, pickup_at, return_at, exclude_reservation_id=None):
    """Moves one provisional booking off a car so this period fits there; returns that car."""

    for car in cars:
        if has_conflicting_maintenance(db, car.id, pickup_at, return_at):
            continue

        in_the_way = _movable(db, car, pickup_at, return_at, exclude_reservation_id)

        if len(in_the_way) != 1:
            continue

        blocker = in_the_way[0]

        # Nothing else may be in the way: the blocker is the only booking overlapping the period.
        others = db.scalar(
            select(Reservation.id).where(
                Reservation.car_id == car.id,
                blocking_reservation_clause(),
                Reservation.id.not_in([blocker.id] + ([exclude_reservation_id] if exclude_reservation_id else [])),
                Reservation.pickup_at < return_at,
                blocking_end() > pickup_at,
            )
        )

        if others is not None:
            continue

        # Without the blocker the car must be at the pickup place when the new booking starts.
        before = db.scalar(
            select(Reservation.return_location_id)
            .where(
                Reservation.car_id == car.id,
                blocking_reservation_clause(),
                Reservation.id != blocker.id,
                Reservation.return_at <= pickup_at,
            )
            .order_by(Reservation.return_at.desc())
            .limit(1)
        )

        if (before or car.current_location_id) != pickup_location_id:
            continue

        target = next(
            (
                other
                for other in cars
                if other.id != car.id
                and _is_free(db, other, blocker.pickup_location_id, blocker.pickup_at, blocker.return_at, blocker.id)
            ),
            None,
        )

        if target is None:
            continue

        blocker.car_id = target.id
        db.flush()

        return car

    return None


def move_provisional_off(db: Session, car: Car, start: datetime, end: datetime) -> bool:
    """For maintenance: gets every booking on the car in this period out of the way by moving
    provisional ones to other cars of its class. True when nothing is left in the way."""

    if car.class_id is None:
        return not has_conflicting_reservation(db, car.id, start, end)

    cars = class_cars(db, car.class_id)

    for other in cars:
        lock_car(db, other.id)

    while has_conflicting_reservation(db, car.id, start, end):
        blockers = _movable(db, car, start, end)

        moved = False

        for blocker in blockers:
            target = next(
                (
                    other
                    for other in cars
                    if other.id != car.id
                    and _is_free(db, other, blocker.pickup_location_id, blocker.pickup_at, blocker.return_at, blocker.id)
                ),
                None,
            )

            if target is not None:
                blocker.car_id = target.id
                db.flush()
                moved = True

        if not moved:
            return False

    return True
