from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Car, Location, MaintenanceTask, Reservation
from app.services.timezones import day_bounds, zone


ACTIVE_RESERVATION_STATUSES = {
    "PENDING",
    "CONFIRMED",
    "ACTIVE",
}

# How long a rental that is past its return time keeps blocking the car. The
# car is not back yet, so it cannot be promised to someone else for the next
# few hours. A rental more than OVERDUE_LIMIT past its return time is a matter
# for staff (a lost or stolen car, or a return nobody recorded) and no longer
# blocks anything by itself, so one forgotten rental cannot lock a car forever.
OVERDUE_BUFFER = timedelta(hours=2)
OVERDUE_LIMIT = timedelta(days=3)


def blocking_reservation_clause(now: datetime | None = None):
    """
    The one definition of "this reservation is in the way of a new booking":
    pending, confirmed and active ones, plus an online booking that is still
    waiting for payment and whose hold has not run out. An expired hold stops
    blocking the moment it expires, whether or not anything has cleaned it up.
    """

    now = now or datetime.now(timezone.utc)

    return or_(
        Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
        and_(Reservation.status == "AWAITING_PAYMENT", Reservation.hold_expires_at > now),
    )


def blocking_end(now: datetime | None = None):
    """When a reservation stops blocking its car: its return time, or for a
    rental still out past that time, a little later (OVERDUE_BUFFER)."""

    now = now or datetime.now(timezone.utc)

    return case(
        (
            and_(Reservation.status == "ACTIVE", Reservation.return_at > now - OVERDUE_LIMIT),
            func.greatest(Reservation.return_at, now + OVERDUE_BUFFER),
        ),
        else_=Reservation.return_at,
    )


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


def lock_car(db: Session, car_id: UUID) -> None:
    """
    Takes a row lock on the car until the transaction ends, so two requests that
    would both book it are handled one after the other: the second one waits
    here, then sees the first one's booking when it checks for conflicts.

    Call it before checking for conflicts, in every path that creates a booking
    or moves one to another car or other dates, and commit soon after (never
    hold it across a call to Stripe). When more than one car is locked, lock
    them in id order so two requests cannot wait on each other.
    """

    db.execute(select(Car.id).where(Car.id == car_id).with_for_update()).first()


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
        blocking_reservation_clause(),
        Reservation.pickup_at < return_at,
        blocking_end() > pickup_at,
    )

    if exclude_reservation_id is not None:
        query = query.where(Reservation.id != exclude_reservation_id)

    return db.scalar(query) is not None


def _maintenance_overlap_conditions(start: datetime, end: datetime):
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


def _open_maintenance_overlapping(start: datetime, end: datetime):
    return (
        select(MaintenanceTask)
        .join(Car, Car.id == MaintenanceTask.car_id)
        .where(*_maintenance_overlap_conditions(start, end))
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
        raise AppError("reservation.return_before_pickup", "Return time must be after pickup time.")

    # One query for the whole location, with the two conflict checks as
    # correlated NOT EXISTS clauses. (This used to loop over the cars and
    # issue two queries each.) The conditions are the same ones
    # has_conflicting_reservation / has_conflicting_maintenance use for a
    # single car.
    reservation_conflict = exists().where(
        Reservation.car_id == Car.id,
        blocking_reservation_clause(),
        Reservation.pickup_at < return_at,
        blocking_end() > pickup_at,
    )

    maintenance_conflict = exists().where(
        MaintenanceTask.car_id == Car.id,
        *_maintenance_overlap_conditions(pickup_at, return_at),
    )

    cars_query = (
        select(Car)
        .where(
            Car.current_location_id == pickup_location_id,
            Car.status == "AVAILABLE",
            ~reservation_conflict,
            ~maintenance_conflict,
        )
        .order_by(Car.license_plate)
    )

    return list(db.scalars(cars_query).all())


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

    # "That day" is the calendar day where the car is: a car in Lisbon and
    # one in Auckland are asked about different 24-hour windows. Cars are
    # grouped by their location's timezone so each group is one window.
    cars_query = (
        select(Car.id, Car.status, Location.timezone)
        .join(Location, Location.id == Car.current_location_id)
    )

    if location_id is not None:
        cars_query = cars_query.where(Car.current_location_id == location_id)

    cars_by_zone: dict[str, list[tuple[UUID, str]]] = {}

    for car_id, live_status, zone_name in db.execute(cars_query).all():
        cars_by_zone.setdefault(zone_name, []).append((car_id, live_status))

    statuses: dict[UUID, str] = {}

    for zone_name, cars in cars_by_zone.items():
        day_start, day_end = day_bounds(target_date, zone(zone_name))
        car_ids = [car_id for car_id, _ in cars]

        overlap_query = select(Reservation.car_id, Reservation.status).where(
            Reservation.car_id.in_(car_ids),
            Reservation.status.in_(relevant_statuses),
            Reservation.pickup_at < day_end,
            Reservation.return_at > day_start,
        )

        car_bucket: dict[UUID, str] = {}

        for car_id, reservation_status in db.execute(overlap_query).all():
            bucket = "RENTED" if reservation_status == "ACTIVE" else "RESERVED"

            if car_bucket.get(car_id) != "RENTED":
                car_bucket[car_id] = bucket

        maintenance_by_car = get_cars_in_maintenance(db, day_start, day_end)

        for car_id, live_status in cars:
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

    return _counts_from_statuses(statuses.values())


def get_fleet_status_counts_by_location(
    db: Session,
    target_date: date,
    cars: list[Car],
) -> dict[UUID, dict[str, int]]:
    """
    The same breakdown as get_fleet_status_counts, for every location at
    once: statuses are derived a single time for the whole fleet and then
    grouped by each car's current location. (Calling get_fleet_status_counts
    per location repeated the same three queries for every location.)
    """

    statuses = _compute_car_statuses_for_date(
        db, target_date, ACTIVE_RESERVATION_STATUSES
    )

    grouped: dict[UUID, list[str]] = {}

    for car in cars:
        grouped.setdefault(car.current_location_id, []).append(statuses[car.id])

    return {
        location_id: _counts_from_statuses(location_statuses)
        for location_id, location_statuses in grouped.items()
    }


def _counts_from_statuses(statuses) -> dict[str, int]:
    counts = {
        "AVAILABLE": 0,
        "RESERVED": 0,
        "RENTED": 0,
        "MAINTENANCE": 0,
        "CLEANING": 0,
    }
    total = 0

    for status in statuses:
        counts[status] += 1
        total += 1

    return {
        "total": total,
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