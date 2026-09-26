"""
Server-side search, segments and paging for the customers list, plus the
counts behind the page's stat tiles. Same idea as reservation_search.py:
the page used to download every customer (with their PII) and filter in the
browser.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Customer, Reservation
from app.services.reservation_search import escape_like

SEGMENTS = {"NEW_THIS_WEEK", "REPEAT"}


def search_customers(
    db: Session,
    *,
    q: str | None = None,
    segment: str | None = None,
    sort: str = "recent",
    limit: int = 25,
    offset: int = 0,
):
    """One page of (Customer, reservation_count, last_reservation_at) rows
    plus the total that match the filters."""

    reservation_count = func.count(Reservation.id)
    last_reservation_at = func.max(Reservation.created_at)

    where = []

    if q and q.strip():
        pattern = f"%{escape_like(q.strip())}%"

        where.append(
            or_(
                func.concat(Customer.first_name, " ", Customer.last_name).ilike(
                    pattern, escape="\\"
                ),
                Customer.address.ilike(pattern, escape="\\"),
                Customer.postal_code.ilike(pattern, escape="\\"),
                Customer.email.ilike(pattern, escape="\\"),
                Customer.phone_number.ilike(pattern, escape="\\"),
            )
        )

    if segment == "NEW_THIS_WEEK":
        where.append(
            Customer.created_at >= datetime.now(timezone.utc) - timedelta(days=7)
        )

    grouped = (
        select(
            Customer,
            reservation_count.label("reservation_count"),
            last_reservation_at.label("last_reservation_at"),
        )
        .outerjoin(Reservation, Reservation.customer_id == Customer.id)
        .where(*where)
        .group_by(Customer.id)
    )

    if segment == "REPEAT":
        grouped = grouped.having(reservation_count >= 2)

    total = db.scalar(select(func.count()).select_from(grouped.subquery())) or 0

    if sort == "name":
        ordering = (Customer.last_name.asc(), Customer.first_name.asc(), Customer.id.asc())
    else:
        ordering = (last_reservation_at.desc().nulls_last(), Customer.id.asc())

    rows = db.execute(grouped.order_by(*ordering).limit(limit).offset(offset)).all()

    return rows, total


def customer_summary(db: Session) -> dict[str, float | int]:
    """Counts for the stat tiles, computed over every customer."""

    per_customer = (
        select(
            Customer.id.label("id"),
            Customer.created_at.label("created_at"),
            func.count(Reservation.id).label("reservations"),
        )
        .outerjoin(Reservation, Reservation.customer_id == Customer.id)
        .group_by(Customer.id)
        .subquery()
    )

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    row = db.execute(
        select(
            func.count().label("total"),
            func.count().filter(per_customer.c.created_at >= week_ago).label(
                "new_this_week"
            ),
            func.count().filter(per_customer.c.reservations >= 2).label(
                "repeat_customers"
            ),
            func.coalesce(func.sum(per_customer.c.reservations), 0).label(
                "total_reservations"
            ),
        ).select_from(per_customer)
    ).one()

    total = row.total

    return {
        "total": total,
        "new_this_week": row.new_this_week,
        "repeat_customers": row.repeat_customers,
        "total_reservations": int(row.total_reservations),
        "avg_reservations": (int(row.total_reservations) / total) if total else 0,
    }
