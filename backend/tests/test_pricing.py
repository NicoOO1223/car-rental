from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.database import SessionLocal
from app.services.configuration import get_configuration
from app.services.pricing import ExtraSelection, calculate_price_breakdown


PRICE_PER_DAY = Decimal("50.00")


def _configuration_kwargs() -> dict:
    """
    Surcharge amounts are admin-editable via the configuration table now,
    not module constants — sourced from the actual seeded row (rather than
    re-hardcoding 5/30.00/50.00 here) so these tests fail if the seeded
    defaults ever drift from what they assert.
    """

    db = SessionLocal()

    try:
        configuration = get_configuration(db)
        return {
            "short_term_threshold_days": configuration.short_term_threshold_days,
            "short_term_fee": configuration.short_term_fee,
            "airport_change_fee": configuration.airport_change_fee,
        }
    finally:
        db.close()


ADDITIONAL_DRIVER = ExtraSelection(
    code="ADDITIONAL_DRIVER",
    name="Additional driver",
    quantity=1,
    unit_price=Decimal("7.00"),
    price_unit="PER_DAY",
)

REFUELING = ExtraSelection(
    code="REFUELING_SERVICE",
    name="Refueling service",
    quantity=1,
    unit_price=Decimal("45.00"),
    price_unit="PER_RENTAL",
)

TWO_BABY_SEATS = ExtraSelection(
    code="BABY_SEAT",
    name="Baby seat",
    quantity=2,
    unit_price=Decimal("6.00"),
    price_unit="PER_DAY",
)


def test_breakdown_no_surcharges_for_long_same_airport_trip():
    same_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 8, 10, 0, tzinfo=timezone.utc),  # 7 days
        same_location,
        same_location,
        **_configuration_kwargs(),
    )

    assert breakdown.base_amount == Decimal("350.00")  # 50 x 7
    assert breakdown.short_term_fee == Decimal("0.00")
    assert breakdown.airport_change_fee == Decimal("0.00")
    assert breakdown.total_amount == Decimal("350.00")


def test_breakdown_short_term_fee_applies_under_5_days():
    same_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 3, 10, 0, tzinfo=timezone.utc),  # 2 days
        same_location,
        same_location,
        **_configuration_kwargs(),
    )

    assert breakdown.base_amount == Decimal("100.00")  # 50 x 2
    assert breakdown.short_term_fee == Decimal("30.00")
    assert breakdown.airport_change_fee == Decimal("0.00")
    assert breakdown.total_amount == Decimal("130.00")


def test_breakdown_exactly_5_days_is_not_short_term():
    same_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 6, 10, 0, tzinfo=timezone.utc),  # exactly 5 days
        same_location,
        same_location,
        **_configuration_kwargs(),
    )

    assert breakdown.short_term_fee == Decimal("0.00")


def test_breakdown_airport_change_fee_applies_for_different_locations():
    pickup_location = uuid4()
    return_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 8, 10, 0, tzinfo=timezone.utc),  # 7 days
        pickup_location,
        return_location,
        **_configuration_kwargs(),
    )

    assert breakdown.short_term_fee == Decimal("0.00")
    assert breakdown.airport_change_fee == Decimal("50.00")
    assert breakdown.total_amount == Decimal("400.00")  # 350 + 50


def test_breakdown_both_surcharges_stack():
    pickup_location = uuid4()
    return_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 3, 10, 0, tzinfo=timezone.utc),  # 2 days
        pickup_location,
        return_location,
        **_configuration_kwargs(),
    )

    assert breakdown.base_amount == Decimal("100.00")
    assert breakdown.short_term_fee == Decimal("30.00")
    assert breakdown.airport_change_fee == Decimal("50.00")
    assert breakdown.total_amount == Decimal("180.00")


# --- Add-ons -------------------------------------------------------------


def test_breakdown_without_extras_is_unchanged():
    """
    Regression guard for the defaulted `extras` parameter: calling with no
    extras must behave exactly as it did before add-ons existed.
    """

    same_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 8, 10, 0, tzinfo=timezone.utc),  # 7 days
        same_location,
        same_location,
        **_configuration_kwargs(),
    )

    assert breakdown.extras == []
    assert breakdown.extras_amount == Decimal("0.00")
    assert breakdown.total_amount == Decimal("350.00")


def test_per_day_extra_scales_with_duration():
    same_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 8, 10, 0, tzinfo=timezone.utc),  # 7 days
        same_location,
        same_location,
        **_configuration_kwargs(),
        extras=[ADDITIONAL_DRIVER],
    )

    assert breakdown.extras[0].amount == Decimal("49.00")  # 7.00 x 7
    assert breakdown.extras_amount == Decimal("49.00")
    assert breakdown.total_amount == Decimal("399.00")  # 350 + 49


def test_per_rental_extra_does_not_scale_with_duration():
    same_location = uuid4()

    long_rental = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 8, 10, 0, tzinfo=timezone.utc),  # 7 days
        same_location,
        same_location,
        **_configuration_kwargs(),
        extras=[REFUELING],
    )

    short_rental = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 3, 10, 0, tzinfo=timezone.utc),  # 2 days
        same_location,
        same_location,
        **_configuration_kwargs(),
        extras=[REFUELING],
    )

    assert long_rental.extras_amount == Decimal("45.00")
    assert short_rental.extras_amount == Decimal("45.00")


def test_extra_quantity_multiplies_line():
    same_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 4, 10, 0, tzinfo=timezone.utc),  # 3 days
        same_location,
        same_location,
        **_configuration_kwargs(),
        extras=[TWO_BABY_SEATS],
    )

    assert breakdown.extras[0].amount == Decimal("36.00")  # 6.00 x 2 x 3


def test_mixed_extras_sum_into_total():
    same_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 3, 10, 0, tzinfo=timezone.utc),  # 2 days
        same_location,
        same_location,
        **_configuration_kwargs(),
        extras=[ADDITIONAL_DRIVER, REFUELING],
    )

    # base 100 + short-term 30 + driver (7 x 2) + refueling 45
    assert breakdown.extras_amount == Decimal("59.00")
    assert breakdown.total_amount == Decimal("189.00")


def test_extras_do_not_affect_surcharge_rules():
    """Add-ons are priced alongside the surcharges, never into them."""

    same_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 7, 10, 0, tzinfo=timezone.utc),  # 6 days
        same_location,
        same_location,
        **_configuration_kwargs(),
        extras=[ADDITIONAL_DRIVER, REFUELING, TWO_BABY_SEATS],
    )

    assert breakdown.short_term_fee == Decimal("0.00")
    assert breakdown.airport_change_fee == Decimal("0.00")


# --- money ---------------------------------------------------------------


def test_to_cents_is_exact_where_float_arithmetic_is_not():
    from decimal import Decimal

    from app.services.money import to_cents

    # int(19.99 * 100) is 1998: the classic floating point trap.
    assert int(19.99 * 100) == 1998
    assert to_cents(Decimal("19.99")) == 1999
    assert to_cents(Decimal("0.01")) == 1
    assert to_cents(Decimal("1234.56")) == 123456
    assert to_cents(0) == 0


def test_to_cents_rounds_half_up():
    from decimal import Decimal

    from app.services.money import to_cents

    assert to_cents(Decimal("0.005")) == 1
    assert to_cents(Decimal("0.004")) == 0
    assert to_cents(Decimal("2.675")) == 268
