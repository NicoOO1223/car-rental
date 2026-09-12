from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.services.pricing import calculate_price_breakdown


PRICE_PER_DAY = Decimal("50.00")


def test_breakdown_no_surcharges_for_long_same_airport_trip():
    same_location = uuid4()

    breakdown = calculate_price_breakdown(
        PRICE_PER_DAY,
        datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc),
        datetime(2027, 1, 8, 10, 0, tzinfo=timezone.utc),  # 7 days
        same_location,
        same_location,
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
    )

    assert breakdown.base_amount == Decimal("100.00")
    assert breakdown.short_term_fee == Decimal("30.00")
    assert breakdown.airport_change_fee == Decimal("50.00")
    assert breakdown.total_amount == Decimal("180.00")
