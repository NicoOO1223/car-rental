from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.errors import AppError

from app.services.return_charges import (
    calculate_fuel_fee,
    calculate_late_fee,
    calculate_late_hours,
    calculate_total_charge,
    validate_damage_charge,
)

SCHEDULED = datetime(2027, 6, 1, 10, 0, tzinfo=timezone.utc)


def late_hours(minutes_late: float, grace: int = 60) -> int:
    return calculate_late_hours(
        SCHEDULED, SCHEDULED + timedelta(minutes=minutes_late), grace
    )


def test_early_or_on_time_is_not_late():
    assert late_hours(-120) == 0
    assert late_hours(0) == 0


def test_within_grace_period_is_not_late():
    assert late_hours(30) == 0
    assert late_hours(60) == 0


def test_past_grace_is_charged_started_hours_from_the_scheduled_time():
    assert late_hours(61) == 2
    assert late_hours(120) == 2
    assert late_hours(121) == 3
    assert late_hours(24 * 60) == 24


def test_zero_grace_charges_the_first_minute():
    assert late_hours(1, grace=0) == 1
    assert late_hours(0, grace=0) == 0


def test_late_fee_is_hourly():
    assert calculate_late_fee(3, Decimal("15.00")) == Decimal("45.00")
    assert calculate_late_fee(0, Decimal("15.00")) == Decimal("0.00")


def test_full_tank_has_no_fuel_fee():
    assert calculate_fuel_fee(8, Decimal("8.00"), Decimal("10.00")) == Decimal("0.00")


def test_missing_fuel_is_charged_per_eighth_plus_service_fee():
    # 3 eighths missing: 3 x 8.00 + 10.00
    assert calculate_fuel_fee(5, Decimal("8.00"), Decimal("10.00")) == Decimal("34.00")
    assert calculate_fuel_fee(0, Decimal("8.00"), Decimal("10.00")) == Decimal("74.00")


@pytest.mark.parametrize("level", [-1, 9])
def test_fuel_level_must_be_within_the_tank(level):
    with pytest.raises(AppError):
        calculate_fuel_fee(level, Decimal("8.00"), Decimal("10.00"))


def test_damage_charge_is_bounded():
    maximum = Decimal("2000.00")

    assert validate_damage_charge(Decimal("0"), maximum) == Decimal("0")
    assert validate_damage_charge(Decimal("2000.00"), maximum) == Decimal("2000.00")

    with pytest.raises(AppError):
        validate_damage_charge(Decimal("-1"), maximum)

    with pytest.raises(AppError):
        validate_damage_charge(Decimal("2000.01"), maximum)


def test_total_adds_all_charges():
    total = calculate_total_charge(Decimal("45.00"), Decimal("34.00"), Decimal("100.00"))

    assert total == Decimal("179.00")


def test_waived_charges_drop_out_of_the_total_but_damage_never_does():
    assert calculate_total_charge(
        Decimal("45.00"),
        Decimal("34.00"),
        Decimal("100.00"),
        late_fee_waived=True,
    ) == Decimal("134.00")

    assert calculate_total_charge(
        Decimal("45.00"),
        Decimal("34.00"),
        Decimal("100.00"),
        late_fee_waived=True,
        fuel_fee_waived=True,
    ) == Decimal("100.00")
