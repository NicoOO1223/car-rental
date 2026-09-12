from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID

# Surcharges applied on top of the base day-rate. Mirrored in the booking
# wizard (frontend/app/reservations/page.tsx) for the pre-booking estimate —
# keep both in sync if these rules change.
SHORT_TERM_THRESHOLD_DAYS = 5
SHORT_TERM_FEE = Decimal("30.00")
AIRPORT_CHANGE_FEE = Decimal("50.00")


def calculate_rental_duration_days(pickup_at: datetime, return_at: datetime) -> int:
    delta = return_at - pickup_at
    return delta.days + (1 if delta.seconds or delta.microseconds else 0)


def calculate_rental_price(
    price_per_day: Decimal,
    pickup_at: datetime,
    return_at: datetime,
) -> Decimal:
    """
    Base rental cost: price_per_day x ceil(duration in days). Used by
    revenue reporting (app/services/dashboard.py), and as the base line of
    calculate_price_breakdown below.
    """

    return price_per_day * calculate_rental_duration_days(pickup_at, return_at)


@dataclass
class PriceBreakdown:
    base_amount: Decimal
    short_term_fee: Decimal
    airport_change_fee: Decimal

    @property
    def total_amount(self) -> Decimal:
        return self.base_amount + self.short_term_fee + self.airport_change_fee


def calculate_price_breakdown(
    price_per_day: Decimal,
    pickup_at: datetime,
    return_at: datetime,
    pickup_location_id: UUID,
    return_location_id: UUID,
) -> PriceBreakdown:
    """
    Itemized reservation cost, applied at handover-payment time (so it
    always reflects the reservation's current dates/locations, including
    any edits made after creation):

    - Base: price_per_day x ceil(duration in days).
    - Short-term fee: +30.00 when the rental runs under 5 days.
    - Airport-change fee: +50.00 when pickup and return airports differ
      (a one-way rental).
    """

    base_amount = calculate_rental_price(price_per_day, pickup_at, return_at)

    short_term_fee = (
        SHORT_TERM_FEE
        if calculate_rental_duration_days(pickup_at, return_at) < SHORT_TERM_THRESHOLD_DAYS
        else Decimal("0.00")
    )

    airport_change_fee = (
        AIRPORT_CHANGE_FEE
        if pickup_location_id != return_location_id
        else Decimal("0.00")
    )

    return PriceBreakdown(
        base_amount=base_amount,
        short_term_fee=short_term_fee,
        airport_change_fee=airport_change_fee,
    )
