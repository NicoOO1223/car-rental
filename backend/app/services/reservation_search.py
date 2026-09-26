"""
Server-side filtering, sorting and counting for the reservations list.

The list page used to download every reservation and filter it in the
browser. These helpers do the same filtering in the database so a page of
results costs the same however many reservations exist. The rules mirror
what the page did client-side, so the same filters give the same rows.
"""

from datetime import datetime, time, timedelta, timezone

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Car, Customer, Location, Reservation
from app.services.timezones import business_zone, day_bounds as zoned_day_bounds, local_today

WINDOWS = {"TODAY", "ACTIVE", "UPCOMING", "NEXT_7_DAYS"}

SORTS = {
    "pickup_asc": (Reservation.pickup_at.asc(), Reservation.id.asc()),
    "pickup_desc": (Reservation.pickup_at.desc(), Reservation.id.asc()),
    "return_asc": (Reservation.return_at.asc(), Reservation.id.asc()),
    "return_desc": (Reservation.return_at.desc(), Reservation.id.asc()),
    "created_desc": (Reservation.created_at.desc(), Reservation.id.asc()),
}


def escape_like(term: str) -> str:
    """Makes user input match literally inside ILIKE."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _day_bounds(
    db: Session,
    now: datetime,
    day_start: datetime | None,
    day_end: datetime | None,
) -> tuple[datetime, datetime]:
    """An explicit day from the caller if it sent one, otherwise today in
    the business's timezone (not the server's, and not UTC)."""

    if day_start is not None and day_end is not None:
        return day_start, day_end

    tz = business_zone(db)

    return zoned_day_bounds(local_today(tz, now), tz)


def _conditions(
    db: Session,
    *,
    q: str | None,
    status: str | None,
    location: str | None,
    window: str | None,
    now: datetime,
    day_start: datetime | None,
    day_end: datetime | None,
    pickup_location: Location,
    return_location: Location,
) -> list:
    conditions = []

    if q and q.strip():
        pattern = f"%{escape_like(q.strip())}%"

        conditions.append(
            or_(
                func.concat(Customer.first_name, " ", Customer.last_name).ilike(
                    pattern, escape="\\"
                ),
                Car.license_plate.ilike(pattern, escape="\\"),
                cast(Reservation.id, String).ilike(pattern, escape="\\"),
                func.concat(Car.make, " ", Car.model).ilike(pattern, escape="\\"),
            )
        )

    if status:
        conditions.append(Reservation.status == status)

    if location:
        conditions.append(
            or_(
                pickup_location.airport_code == location,
                return_location.airport_code == location,
            )
        )

    if window == "TODAY":
        start, end = _day_bounds(db, now, day_start, day_end)
        conditions.append(
            or_(
                (Reservation.pickup_at >= start) & (Reservation.pickup_at < end),
                (Reservation.return_at >= start) & (Reservation.return_at < end),
            )
        )
    elif window == "UPCOMING":
        conditions.append(Reservation.status == "CONFIRMED")
        conditions.append(Reservation.pickup_at > now)
    elif window == "NEXT_7_DAYS":
        conditions.append(Reservation.pickup_at >= now)
        conditions.append(Reservation.pickup_at <= now + timedelta(days=7))
    elif window == "ACTIVE":
        conditions.append(Reservation.pickup_at <= now)
        conditions.append(Reservation.return_at >= now)

    return conditions


def search_reservations(
    db: Session,
    *,
    q: str | None = None,
    status: str | None = None,
    location: str | None = None,
    window: str | None = None,
    sort: str = "pickup_asc",
    limit: int = 25,
    offset: int = 0,
    day_start: datetime | None = None,
    day_end: datetime | None = None,
) -> tuple[list[Reservation], int]:
    """One page of reservations plus the total that match the filters."""

    from sqlalchemy.orm import aliased

    pickup_location = aliased(Location)
    return_location = aliased(Location)
    now = datetime.now(timezone.utc)

    conditions = _conditions(
        db,
        q=q,
        status=status,
        location=location,
        window=window,
        now=now,
        day_start=day_start,
        day_end=day_end,
        pickup_location=pickup_location,
        return_location=return_location,
    )

    def joined(statement):
        return (
            statement.join(Customer, Customer.id == Reservation.customer_id)
            .join(Car, Car.id == Reservation.car_id)
            .join(pickup_location, pickup_location.id == Reservation.pickup_location_id)
            .join(return_location, return_location.id == Reservation.return_location_id)
            .where(*conditions)
        )

    total = db.scalar(joined(select(func.count(Reservation.id)))) or 0

    rows = db.scalars(
        joined(select(Reservation))
        .options(
            joinedload(Reservation.customer),
            joinedload(Reservation.car),
            joinedload(Reservation.pickup_location),
            joinedload(Reservation.return_location),
            # selectinload, not joinedload: extras is a collection, and
            # joining it would fan out parent rows and break LIMIT.
            selectinload(Reservation.extras),
        )
        .order_by(*SORTS.get(sort, SORTS["pickup_asc"]))
        .limit(limit)
        .offset(offset)
    ).all()

    return list(rows), total


def reservation_summary(
    db: Session,
    *,
    day_start: datetime | None = None,
    day_end: datetime | None = None,
) -> dict[str, int]:
    """The counts behind the reservation page's stat tiles, in one query."""

    now = datetime.now(timezone.utc)
    start, end = _day_bounds(db, now, day_start, day_end)

    not_cancelled = Reservation.status != "CANCELLED"

    def count_where(*criteria):
        return func.count(Reservation.id).filter(*criteria)

    row = db.execute(
        select(
            func.count(Reservation.id).label("total"),
            count_where(
                not_cancelled,
                Reservation.pickup_at >= start,
                Reservation.pickup_at < end,
            ).label("pickup_today"),
            count_where(
                not_cancelled,
                Reservation.return_at >= start,
                Reservation.return_at < end,
            ).label("return_today"),
            count_where(
                not_cancelled,
                Reservation.status != "COMPLETED",
                Reservation.pickup_at <= now,
                Reservation.return_at >= now,
            ).label("active"),
            count_where(
                not_cancelled,
                Reservation.status == "CONFIRMED",
                Reservation.pickup_at > now,
            ).label("upcoming"),
            count_where(
                Reservation.status == "ACTIVE",
                Reservation.return_at < now,
            ).label("overdue_returns"),
        )
    ).one()

    return dict(row._mapping)
