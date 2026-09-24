from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import Car, MaintenanceTask, Reservation


ACTIVE_RESERVATION_STATUSES = {
    "PENDING",
    "CONFIRMED",
    "ACTIVE",
}

# Narrower than ACTIVE_RESERVATION_STATUSES: the fleet overview's
# "status as of date" only reflects reservations an employee has actually
# approved (or that are already underway) — a still-pending request
# shouldn't make a car read as booked to someone glancing at the fleet
# page, even though it does still block new bookings for that slot
# (see ACTIVE_RESERVATION_STATUSES / has_conflicting_reservation above).
FLEET_OVERVIEW_RESERVATION_STATUSES = {
    "CONFIRMED",
    "ACTIVE",
}


def has_conflicting_reservation(
    db: Session,
    car_id: UUID,
    pickup_at: datetime,
    return_at: datetime,
    exclude_reservation_id: UUID | None = None,
) -> bool:
    """
    Return True if the given car has an active reservation that
    overlaps the requested pickup/return period.
    """

    query = select(Reservation.id).where(
        Reservation.car_id == car_id,
        Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
        Reservation.pickup_at < return_at,
        Reservation.return_at > pickup_at,
    )

    if exclude_reservation_id is not None:
        query = query.where(Reservation.id != exclude_reservation_id)

    return db.scalar(query) is not None


def _open_maintenance_overlapping(start: datetime, end: datetime):
    """
    OPEN maintenance/cleaning tasks whose window overlaps [start, end).

    A task with no ends_at predates windows: it was carried entirely by
    Car.status, so it only counts while the car is still marked
    MAINTENANCE/CLEANING — setting the car back to AVAILABLE releases it,
    as it always did. A task with no starts_at is treated as starting when
    it was opened.
    """

    window_start = func.coalesce(
        MaintenanceTask.starts_at, MaintenanceTask.opened_at
    )

    return (
        select(MaintenanceTask)
        .join(Car, Car.id == MaintenanceTask.car_id)
        .where(
            MaintenanceTask.status == "OPEN",
            window_start < end,
            or_(
                MaintenanceTask.ends_at > start,
                and_(
                    MaintenanceTask.ends_at.is_(None),
                    Car.status.in_(("MAINTENANCE", "CLEANING")),
                ),
            ),
        )
    )


def has_conflicting_maintenance(
    db: Session,
    car_id: UUID,
    start: datetime,
    end: datetime,
    exclude_task_id: UUID | None = None,
) -> bool:
    """
    Return True if the car has an OPEN maintenance/cleaning window
    overlapping the given period.
    """

    query = _open_maintenance_overlapping(start, end).where(
        MaintenanceTask.car_id == car_id
    )

    if exclude_task_id is not None:
        query = query.where(MaintenanceTask.id != exclude_task_id)

    return db.scalars(query).first() is not None


def get_cars_in_maintenance(
    db: Session,
    start: datetime,
    end: datetime,
) -> dict[UUID, str]:
    """
    car_id -> task_type (MAINTENANCE | CLEANING) for every car with an OPEN
    task overlapping [start, end).
    """

    return {
        task.car_id: task.task_type
        for task in db.scalars(_open_maintenance_overlapping(start, end)).all()
    }


def get_current_maintenance_by_car(db: Session) -> dict[UUID, str]:
    """Cars whose maintenance window contains this very moment."""

    now = datetime.now(timezone.utc)

    return get_cars_in_maintenance(db, now, now + timedelta(seconds=1))


def get_available_cars(
    db: Session,
    pickup_location_id: UUID,
    pickup_at: datetime,
    return_at: datetime,
) -> list[Car]:
    """
    Return cars that are operational, located at the requested airport,
    and have no conflicting reservation during the requested period.
    """

    # Basic validation
    if return_at <= pickup_at:
        raise ValueError("Return time must be after pickup time.")

    # Cars that are operational and located at the requested airport
    cars_query = select(Car).where(
        Car.current_location_id == pickup_location_id,
        Car.status == "AVAILABLE",
    )

    cars = db.scalars(cars_query).all()

    if not cars:
        return []

    available_cars = []

    for car in cars:
        if has_conflicting_reservation(db, car.id, pickup_at, return_at):
            continue

        if has_conflicting_maintenance(db, car.id, pickup_at, return_at):
            continue

        available_cars.append(car)

    return available_cars


def _compute_car_statuses_for_date(
    db: Session,
    target_date: date,
    relevant_statuses: set[str],
    location_id: UUID | None = None,
) -> dict[UUID, str]:
    """
    Shared per-car status derivation "as of" a given calendar day, derived
    from reservation data rather than the live Car.status field:

    - A car with a reservation (in `relevant_statuses`) overlapping that
      day whose own status is ACTIVE counts as RENTED.
    - A car with a matching reservation overlapping that day that isn't
      ACTIVE (e.g. CONFIRMED, or PENDING if included) counts as RESERVED.
    - Otherwise, if an OPEN maintenance/cleaning window overlaps that day,
      the task's type is used.
    - Otherwise, if the car's live status is MAINTENANCE or CLEANING, that
      is carried through as-is (a status set directly, with no window
      behind it, isn't date-sensitive).
    - Otherwise the car counts as AVAILABLE.

    This intentionally does not read Car.status for the RENTED/RESERVED
    determination, only for the MAINTENANCE/CLEANING fallback — a car can
    have a stale/manually-set status with no reservation backing it.

    Callers pass different `relevant_statuses` for different questions —
    see ACTIVE_RESERVATION_STATUSES vs FLEET_OVERVIEW_RESERVATION_STATUSES.
    """

    day_start = datetime.combine(target_date, time.min, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    overlap_query = (
        select(Reservation.car_id, Reservation.status)
        .join(Car, Car.id == Reservation.car_id)
        .where(
            Reservation.status.in_(relevant_statuses),
            Reservation.pickup_at < day_end,
            Reservation.return_at > day_start,
        )
    )

    if location_id is not None:
        overlap_query = overlap_query.where(
            Car.current_location_id == location_id
        )

    car_bucket: dict[UUID, str] = {}

    for car_id, reservation_status in db.execute(overlap_query).all():
        bucket = "RENTED" if reservation_status == "ACTIVE" else "RESERVED"

        if car_bucket.get(car_id) != "RENTED":
            car_bucket[car_id] = bucket

    maintenance_by_car = get_cars_in_maintenance(db, day_start, day_end)

    cars_query = select(Car.id, Car.status)

    if location_id is not None:
        cars_query = cars_query.where(Car.current_location_id == location_id)

    statuses: dict[UUID, str] = {}

    for car_id, live_status in db.execute(cars_query).all():
        if car_id in car_bucket:
            statuses[car_id] = car_bucket[car_id]
        elif car_id in maintenance_by_car:
            statuses[car_id] = maintenance_by_car[car_id]
        elif live_status in ("MAINTENANCE", "CLEANING"):
            statuses[car_id] = live_status
        else:
            statuses[car_id] = "AVAILABLE"

    return statuses


def get_fleet_status_counts(
    db: Session,
    target_date: date,
    location_id: UUID | None = None,
) -> dict[str, int]:
    """
    Fleet-wide status breakdown "as of" a given calendar day — a still-
    pending reservation counts as a tentative RESERVED here (see
    ACTIVE_RESERVATION_STATUSES), since the dashboard wants to show a slot
    as held while it's under review, not just once approved.
    """

    statuses = _compute_car_statuses_for_date(
        db, target_date, ACTIVE_RESERVATION_STATUSES, location_id
    )

    counts = {
        "AVAILABLE": 0,
        "RESERVED": 0,
        "RENTED": 0,
        "MAINTENANCE": 0,
        "CLEANING": 0,
    }

    for status in statuses.values():
        counts[status] += 1

    return {
        "total": len(statuses),
        "available": counts["AVAILABLE"],
        "reserved": counts["RESERVED"],
        "rented": counts["RENTED"],
        "maintenance": counts["MAINTENANCE"],
        "cleaning": counts["CLEANING"],
    }


def get_car_statuses_for_date(
    db: Session,
    target_date: date,
) -> dict[UUID, str]:
    """
    Per-car status "as of" a given calendar day, for the fleet overview
    page — only CONFIRMED/ACTIVE reservations count (see
    FLEET_OVERVIEW_RESERVATION_STATUSES), so a car with only a pending
    request still reads as available to an employee scanning the fleet.
    """

    return _compute_car_statuses_for_date(
        db, target_date, FLEET_OVERVIEW_RESERVATION_STATUSES
    )