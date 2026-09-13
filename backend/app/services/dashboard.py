from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Car, Reservation
from app.services.pricing import calculate_rental_price


def get_daily_revenue(
    db: Session,
    start_date: date,
    end_date: date,
) -> list[tuple[date, float]]:
    """
    Earned revenue (price_per_day x rental duration) from COMPLETED
    reservations, attributed to each reservation's pickup date (the day
    the rental started), for every day in [start_date, end_date]
    inclusive. Days with no completed pickups are included with 0
    revenue so a line chart built from this has no gaps.

    This is deliberately *vehicle* revenue, not money taken: it excludes
    the short-term and airport-change surcharges, and it excludes add-ons
    (reservation_extras). Widening it to total charged is a separate
    decision — it needs a reservation_extras join and would move the
    figure the seeded-data test pins.
    """

    if start_date > end_date:
        raise ValueError("start_date must be on or before end_date.")

    range_start = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
    range_end = datetime.combine(end_date, time.min, tzinfo=timezone.utc) + timedelta(
        days=1
    )

    rows = db.execute(
        select(Reservation.pickup_at, Reservation.return_at, Car.price_per_day)
        .join(Car, Car.id == Reservation.car_id)
        .where(
            Reservation.status == "COMPLETED",
            Reservation.pickup_at >= range_start,
            Reservation.pickup_at < range_end,
        )
    ).all()

    revenue_by_day: dict[date, float] = {}

    for pickup_at, return_at, price_per_day in rows:
        revenue = float(calculate_rental_price(price_per_day, pickup_at, return_at))

        day = pickup_at.date()
        revenue_by_day[day] = revenue_by_day.get(day, 0.0) + revenue

    points: list[tuple[date, float]] = []
    current = start_date

    while current <= end_date:
        points.append((current, revenue_by_day.get(current, 0.0)))
        current += timedelta(days=1)

    return points
