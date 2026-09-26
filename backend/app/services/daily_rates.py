import math
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Car

MAX_RANGE_DAYS = 400


def get_daily_rates(
    db: Session,
    location_id: UUID,
    start_date: date,
    end_date: date,
) -> list[tuple[date, Decimal]]:
    """
    The day rate shown for each date in [start_date, end_date]: the average
    price_per_day of the available cars at that location, rounded down to a
    whole amount. The booking calendar is shown before a car has been
    picked, so it can only give a representative figure.

    Every day currently gets the same figure. This is the single place to
    make it depend on the date once customized pricing exists; the calendar
    only ever displays what this returns.
    """

    if end_date < start_date:
        raise AppError("date_range.start_after_end", "end_date must not be before start_date.")

    if (end_date - start_date).days > MAX_RANGE_DAYS:
        raise AppError(
            "date_range.too_long",
            f"Date range must not exceed {MAX_RANGE_DAYS} days.",
            max_days=MAX_RANGE_DAYS,
        )

    average = db.scalar(
        select(func.avg(Car.price_per_day)).where(
            Car.current_location_id == location_id,
            Car.status == "AVAILABLE",
        )
    )

    if average is None:
        return []

    rate = Decimal(math.floor(average))

    return [
        (start_date + timedelta(days=offset), rate)
        for offset in range((end_date - start_date).days + 1)
    ]
