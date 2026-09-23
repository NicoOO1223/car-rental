from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Sequence
from uuid import UUID

# Surcharges applied on top of the base day-rate are admin-editable via the
# configuration table (app/models/configuration.py,
# app/services/configuration.py) rather than constants, unlike
# PRICE_UNIT_PER_DAY/PRICE_UNIT_PER_RENTAL below, which are fixed enum
# values, not business-rule amounts. Callers fetch the current values with
# get_configuration() and pass them into calculate_price_breakdown() below,
# which stays free of any DB dependency so it remains unit-testable on its
# own.

# How an add-on's catalog price scales. Stored on each extras row and
# snapshotted onto each reservation_extras row at booking time.
PRICE_UNIT_PER_DAY = "PER_DAY"
PRICE_UNIT_PER_RENTAL = "PER_RENTAL"


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


@dataclass(frozen=True)
class ExtraSelection:
    """
    A chosen add-on with its prices already resolved — either from the live
    catalog (quoting, creating a booking) or from a reservation's
    snapshotted reservation_extras rows (charging, printing the agreement).

    A plain value object on purpose: this module imports nothing from
    app.models and stays unit-testable without a database.
    """

    code: str
    name: str
    quantity: int
    unit_price: Decimal
    price_unit: str


@dataclass(frozen=True)
class ExtraLine:
    """An ExtraSelection priced against a concrete rental duration."""

    code: str
    name: str
    quantity: int
    unit_price: Decimal
    price_unit: str
    amount: Decimal


@dataclass
class PriceBreakdown:
    base_amount: Decimal
    short_term_fee: Decimal
    airport_change_fee: Decimal
    # Defaulted so every call site and test that predates add-ons keeps
    # constructing a valid, extras-free breakdown unchanged.
    extras: list[ExtraLine] = field(default_factory=list)

    @property
    def extras_amount(self) -> Decimal:
        return sum(
            (line.amount for line in self.extras),
            Decimal("0.00"),
        )

    @property
    def total_amount(self) -> Decimal:
        return (
            self.base_amount
            + self.short_term_fee
            + self.airport_change_fee
            + self.extras_amount
        )


def calculate_extra_line(selection: ExtraSelection, rental_days: int) -> ExtraLine:
    """
    Price one add-on against a rental duration:

    - PER_DAY:    unit_price x quantity x rental days
    - PER_RENTAL: unit_price x quantity, regardless of duration
    """

    multiplier = rental_days if selection.price_unit == PRICE_UNIT_PER_DAY else 1

    return ExtraLine(
        code=selection.code,
        name=selection.name,
        quantity=selection.quantity,
        unit_price=selection.unit_price,
        price_unit=selection.price_unit,
        amount=selection.unit_price * selection.quantity * multiplier,
    )


def calculate_price_breakdown(
    price_per_day: Decimal,
    pickup_at: datetime,
    return_at: datetime,
    pickup_location_id: UUID,
    return_location_id: UUID,
    *,
    short_term_threshold_days: int,
    short_term_fee: Decimal,
    airport_change_fee: Decimal,
    extras: Sequence[ExtraSelection] = (),
) -> PriceBreakdown:
    """
    Itemized reservation cost, applied at handover-payment time (so it
    always reflects the reservation's current dates/locations, including
    any edits made after creation):

    - Base: price_per_day x ceil(duration in days).
    - Short-term fee: applied when the rental runs under
      short_term_threshold_days.
    - Airport-change fee: applied when pickup and return airports differ
      (a one-way rental).
    - Extras: each selected add-on at its snapshotted unit price, times its
      quantity, times the duration for per-day extras. Extras deliberately
      do not affect the short-term or airport rules.

    short_term_threshold_days/short_term_fee/airport_change_fee come from
    the configuration table (app/services/configuration.py::get_configuration) — passed in
    by the caller rather than read here, so this function stays a pure,
    DB-free calculation.

    Extras share calculate_rental_duration_days with the base rental, so
    the two can never disagree about how long the rental is.
    """

    rental_days = calculate_rental_duration_days(pickup_at, return_at)

    base_amount = price_per_day * rental_days

    short_term_fee_amount = (
        short_term_fee
        if rental_days < short_term_threshold_days
        else Decimal("0.00")
    )

    airport_change_fee_amount = (
        airport_change_fee
        if pickup_location_id != return_location_id
        else Decimal("0.00")
    )

    return PriceBreakdown(
        base_amount=base_amount,
        short_term_fee=short_term_fee_amount,
        airport_change_fee=airport_change_fee_amount,
        extras=[
            calculate_extra_line(selection, rental_days)
            for selection in extras
        ],
    )
