from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Car, CheckOut, Handover, Reservation
from app.services.pricing import calculate_rental_price
from app.services.timezones import business_zone, local_date, range_bounds


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

    # Days are the business's calendar days, not UTC's.
    tz = business_zone(db)
    range_start, range_end = range_bounds(start_date, end_date, tz)

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

        day = local_date(pickup_at, tz)
        revenue_by_day[day] = revenue_by_day.get(day, 0.0) + revenue

    points: list[tuple[date, float]] = []
    current = start_date

    while current <= end_date:
        points.append((current, revenue_by_day.get(current, 0.0)))
        current += timedelta(days=1)

    return points


@dataclass
class CollectedRevenue:
    points: list[tuple[date, float]]
    total_collected: float
    card_total: float
    cash_total: float
    total_refunded: float


def get_collected_revenue(
    db: Session,
    start_date: date,
    end_date: date,
) -> CollectedRevenue:
    """
    Money actually collected — Handover.payment_amount and, since the
    return flow, CheckOut.payment_amount (late/fuel/damage charges) where
    payment_status == "SUCCEEDED", attributed to the day it was paid
    (paid_at), for every day in [start_date, end_date] inclusive. A
    refunded handover excludes itself automatically once its status
    moves to REFUNDED, so no separate subtraction is needed here;
    refunds are totalled separately below, by the day they were issued.

    This is the counterpart to get_daily_revenue() above: that one is
    *vehicle* revenue (day-rate x duration of completed rentals,
    attributed to pickup date); this one is cash actually taken
    (attributed to payment date), includes surcharges and add-ons
    baked into payment_amount, and is split by payment method.
    """

    if start_date > end_date:
        raise ValueError("start_date must be on or before end_date.")

    # Days are the business's calendar days, not UTC's.
    tz = business_zone(db)
    range_start, range_end = range_bounds(start_date, end_date, tz)

    paid_rows = list(
        db.execute(
            select(
                Handover.paid_at, Handover.payment_amount, Handover.payment_method
            ).where(
                Handover.payment_status == "SUCCEEDED",
                Handover.paid_at >= range_start,
                Handover.paid_at < range_end,
            )
        ).all()
    )

    paid_rows += db.execute(
        select(
            CheckOut.paid_at, CheckOut.payment_amount, CheckOut.payment_method
        ).where(
            CheckOut.payment_status == "SUCCEEDED",
            CheckOut.paid_at >= range_start,
            CheckOut.paid_at < range_end,
        )
    ).all()

    # The part of a security deposit taken for return charges is money
    # collected, on the day it was settled and by the deposit's own method.
    paid_rows += db.execute(
        select(
            CheckOut.deposit_settled_at,
            CheckOut.deposit_applied,
            Handover.deposit_method,
        )
        .join(Handover, Handover.reservation_id == CheckOut.reservation_id)
        .where(
            CheckOut.deposit_applied > 0,
            CheckOut.deposit_settled_at >= range_start,
            CheckOut.deposit_settled_at < range_end,
        )
    ).all()

    collected_by_day: dict[date, float] = {}
    card_total = 0.0
    cash_total = 0.0

    for paid_at, payment_amount, payment_method in paid_rows:
        amount = float(payment_amount) if payment_amount is not None else 0.0
        day = local_date(paid_at, tz)
        collected_by_day[day] = collected_by_day.get(day, 0.0) + amount

        if payment_method == "CARD":
            card_total += amount
        elif payment_method == "CASH":
            cash_total += amount

    points: list[tuple[date, float]] = []
    current = start_date

    while current <= end_date:
        points.append((current, collected_by_day.get(current, 0.0)))
        current += timedelta(days=1)

    total_refunded = db.scalar(
        select(func.coalesce(func.sum(Handover.refund_amount), 0)).where(
            Handover.refunded_at >= range_start,
            Handover.refunded_at < range_end,
        )
    )

    return CollectedRevenue(
        points=points,
        total_collected=sum(collected_by_day.values()),
        card_total=card_total,
        cash_total=cash_total,
        total_refunded=float(total_refunded or 0),
    )
