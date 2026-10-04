from dataclasses import dataclass, field
from datetime import datetime
from datetime import timezone
from decimal import Decimal
from typing import Sequence
from uuid import UUID

from app.services.money import round_money
from app.services.timezones import zone

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


def calculate_rental_duration_days(
    pickup_at: datetime, return_at: datetime, timezone_name: str | None = None
) -> int:
    """
    How many rental days to charge: whole days, and any part of a day counts as a
    day (24 hours and 1 minute is 2 days).

    The days are counted on the wall clock at the pickup place when its timezone
    is given: Saturday 10:00 to Monday 10:00 is 2 days even when the clocks go
    back in between and 49 hours pass. Counting elapsed hours instead billed that
    a third day. The return time is read on the pickup place's clock too, so a
    one-way rental is measured the same way whichever end the renter looks at.

    Without a timezone the elapsed time between the two instants is used, which
    is the same thing in UTC.
    """

    if timezone_name:
        tz = zone(timezone_name)

        pickup_at = _on_wall_clock(pickup_at, tz)
        return_at = _on_wall_clock(return_at, tz)

    delta = return_at - pickup_at

    return delta.days + (1 if delta.seconds or delta.microseconds else 0)


def _on_wall_clock(instant: datetime, tz) -> datetime:
    """The time the clocks in `tz` show, with the zone dropped so that two of them
    subtract as the clock reads, not as hours elapsed. A time with no zone is UTC,
    which is what the application has always stored."""

    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)

    return instant.astimezone(tz).replace(tzinfo=None)


def calculate_rental_price(
    price_per_day: Decimal,
    pickup_at: datetime,
    return_at: datetime,
    timezone_name: str | None = None,
) -> Decimal:
    """
    Base rental cost: price_per_day x ceil(duration in days). Used by
    revenue reporting (app/services/dashboard.py), and as the base line of
    calculate_price_breakdown below.
    """

    return price_per_day * calculate_rental_duration_days(pickup_at, return_at, timezone_name)


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
    # VAT. The defaults (0%, prices include VAT) leave every total exactly
    # what it was before VAT existed.
    vat_rate: Decimal = Decimal("0.00")
    prices_include_vat: bool = True

    @property
    def extras_amount(self) -> Decimal:
        return sum(
            (line.amount for line in self.extras),
            Decimal("0.00"),
        )

    @property
    def lines_amount(self) -> Decimal:
        """The itemized lines added up, in the price basis they were entered
        in: gross when prices include VAT, net when they do not."""

        return (
            self.base_amount
            + self.short_term_fee
            + self.airport_change_fee
            + self.extras_amount
        )

    @property
    def vat_amount(self) -> Decimal:
        """
        The VAT in this booking, worked out once on the whole amount and
        rounded once, never per line (per-line rounding can drift a cent
        from the total).

        - Prices include VAT: the VAT is the part of the total that is tax,
          total x rate / (100 + rate).
        - Prices exclude VAT: the VAT is added on top, lines x rate / 100.
        """

        if self.vat_rate <= 0:
            return Decimal("0.00")

        if self.prices_include_vat:
            return round_money(self.lines_amount * self.vat_rate / (100 + self.vat_rate))

        return round_money(self.lines_amount * self.vat_rate / 100)

    @property
    def total_amount(self) -> Decimal:
        """What the customer pays. Unchanged by VAT when prices include it;
        VAT is added when they do not."""

        if self.prices_include_vat:
            return self.lines_amount

        return self.lines_amount + self.vat_amount

    @property
    def net_amount(self) -> Decimal:
        """The total before VAT."""

        return self.total_amount - self.vat_amount


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
    vat_rate: Decimal = Decimal("0.00"),
    prices_include_vat: bool = True,
    timezone_name: str | None = None,
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

    timezone_name is the pickup place's: the days are counted on its wall clock
    (see calculate_rental_duration_days).

    vat_rate and prices_include_vat (Configuration) decide how VAT is shown
    and whether it is added to the total; see PriceBreakdown.vat_amount.
    """

    rental_days = calculate_rental_duration_days(pickup_at, return_at, timezone_name)

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
        vat_rate=Decimal(vat_rate),
        prices_include_vat=prices_include_vat,
    )
