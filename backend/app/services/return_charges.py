"""
Charges applied when a rental is checked back in.

Pure functions with no database access, like app/services/pricing.py, so
the rules are unit-testable on their own. Callers read the rates from the
configuration table (app/services/configuration.py) and pass them in.

Cars are handed out with a full tank, so fuel is charged on how much of
the tank is missing. (The fuel level at pickup is not recorded, and the
rental agreement states a same-to-same fuel policy.)
"""

import math
from datetime import datetime, timedelta
from decimal import Decimal
from app.errors import AppError

FULL_TANK_EIGHTHS = 8


def calculate_late_hours(
    scheduled_return_at: datetime,
    returned_at: datetime,
    grace_minutes: int,
) -> int:
    """
    Started hours late, counted from the scheduled return. A return within
    the grace period is not late at all; one minute past it is charged the
    whole first hour (and, e.g., 61 minutes late once grace has passed is
    two hours).
    """

    lateness = returned_at - scheduled_return_at

    if lateness <= timedelta(minutes=grace_minutes):
        return 0

    return math.ceil(lateness.total_seconds() / 3600)


def calculate_late_fee(late_hours: int, fee_per_hour: Decimal) -> Decimal:
    return fee_per_hour * late_hours


def calculate_fuel_fee(
    fuel_eighths: int,
    fee_per_eighth: Decimal,
    service_fee: Decimal,
) -> Decimal:
    """Per missing eighth, plus the refuelling service fee once any is missing."""

    if not 0 <= fuel_eighths <= FULL_TANK_EIGHTHS:
        raise AppError("return_charge.fuel_level_must_between_0_and", "The fuel level must be between 0 and 8 eighths.")

    missing = FULL_TANK_EIGHTHS - fuel_eighths

    if missing == 0:
        return Decimal("0.00")

    return fee_per_eighth * missing + service_fee


def validate_damage_charge(amount: Decimal, maximum: Decimal) -> Decimal:
    if amount < 0:
        raise AppError("return_charge.damage_charge_cannot_negative", "The damage charge cannot be negative.")

    if amount > maximum:
        raise AppError(
            "return_charge.damage_over_maximum",
            f"The damage charge cannot exceed the configured maximum of {maximum:.2f}.",
            maximum=f"{maximum:.2f}",
        )

    return amount


def calculate_total_charge(
    late_fee: Decimal,
    fuel_fee: Decimal,
    damage_charge: Decimal,
    *,
    late_fee_waived: bool = False,
    fuel_fee_waived: bool = False,
) -> Decimal:
    """Damage is never waived here: it is whatever the employee entered."""

    total = damage_charge

    if not late_fee_waived:
        total += late_fee

    if not fuel_fee_waived:
        total += fuel_fee

    return total.quantize(Decimal("0.01"))


def settle_deposit(total_charge: Decimal, deposit_amount: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    """
    How a held deposit covers the return charges: (applied, returned,
    due_now). The charges are taken from the deposit first; whatever is left
    of the deposit goes back to the customer, and whatever the deposit
    can't cover is still to be collected.
    """

    zero = Decimal("0.00")

    applied = min(max(total_charge, zero), deposit_amount)
    returned = deposit_amount - applied
    due_now = max(total_charge, zero) - applied

    return applied, returned, due_now
