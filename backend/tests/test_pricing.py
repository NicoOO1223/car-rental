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


# --- counting days on the clock at the pickup place -----------------------------------------------------


def _utc(text):
    from datetime import datetime, timezone

    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


def _local(text, zone_name):
    """The instant the clocks in `zone_name` show `text` at, as a UTC datetime, which
    is what the database and the API hand the pricing code. (Two datetimes that share
    one zone object subtract on the wall clock in Python, which would hide the very
    thing under test.)"""

    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo

    return datetime.fromisoformat(text).replace(tzinfo=ZoneInfo(zone_name)).astimezone(timezone.utc)


ROME = "Europe/Rome"


def test_a_rental_across_the_autumn_clock_change_is_not_charged_an_extra_day():
    from app.services.pricing import calculate_rental_duration_days

    # The clocks in Italy go back on 2026-10-25: Saturday 10:00 to Monday 10:00 is
    # 49 hours, but two days on the wall clock.
    pickup = _local("2026-10-24T10:00:00", ROME)
    drop = _local("2026-10-26T10:00:00", ROME)

    assert (drop - pickup).total_seconds() / 3600 == 49
    assert calculate_rental_duration_days(pickup, drop) == 3  # elapsed hours, as before
    assert calculate_rental_duration_days(pickup, drop, ROME) == 2


def test_the_spring_clock_change_and_ordinary_days_are_counted_the_same_either_way():
    from app.services.pricing import calculate_rental_duration_days

    # 2026-03-29: the clocks go forward, so these two days are only 47 hours.
    spring = (_local("2026-03-28T10:00:00", ROME), _local("2026-03-30T10:00:00", ROME))
    ordinary = (_local("2026-06-01T10:00:00", ROME), _local("2026-06-04T10:00:00", ROME))

    for pickup, drop in (spring, ordinary):
        assert calculate_rental_duration_days(pickup, drop, ROME) == calculate_rental_duration_days(pickup, drop)

    assert calculate_rental_duration_days(*spring, ROME) == 2
    assert calculate_rental_duration_days(*ordinary, ROME) == 3


def test_any_part_of_a_day_is_still_a_day_on_the_wall_clock():
    from app.services.pricing import calculate_rental_duration_days

    assert calculate_rental_duration_days(_local("2026-06-01T10:00:00", ROME), _local("2026-06-02T10:00:00", ROME), ROME) == 1
    assert calculate_rental_duration_days(_local("2026-06-01T10:00:00", ROME), _local("2026-06-02T10:01:00", ROME), ROME) == 2
    assert calculate_rental_duration_days(_local("2026-06-01T10:00:00", ROME), _local("2026-06-01T10:30:00", ROME), ROME) == 1
    # Across the autumn change, a minute over is still a minute over.
    assert calculate_rental_duration_days(_local("2026-10-24T10:00:00", ROME), _local("2026-10-26T10:01:00", ROME), ROME) == 3


def test_the_days_are_counted_at_the_pickup_place_even_if_the_return_is_elsewhere():
    from app.services.pricing import calculate_rental_duration_days

    pickup = _local("2026-06-01T10:00:00", ROME)
    # 09:00 in Lisbon is 10:00 in Rome, two days later.
    drop = _local("2026-06-03T09:00:00", "Europe/Lisbon")

    assert calculate_rental_duration_days(pickup, drop, ROME) == 2
    # A minute later in Lisbon is a minute past two days in Rome.
    assert calculate_rental_duration_days(pickup, _local("2026-06-03T09:01:00", "Europe/Lisbon"), ROME) == 3


def test_times_without_a_zone_are_utc_and_a_missing_or_unknown_zone_changes_nothing():
    from datetime import datetime

    from app.services.pricing import calculate_rental_duration_days

    naive = (datetime(2026, 10, 24, 10), datetime(2026, 10, 26, 10))

    assert calculate_rental_duration_days(*naive) == 2
    assert calculate_rental_duration_days(*naive, "UTC") == 2
    assert calculate_rental_duration_days(*naive, "Not/AZone") == 2
    assert calculate_rental_duration_days(*naive, None) == 2


def test_the_price_breakdown_charges_the_wall_clock_days_for_the_rental_and_its_per_day_extras():
    from decimal import Decimal
    from uuid import uuid4

    from app.services.pricing import ExtraSelection, calculate_price_breakdown

    place = uuid4()
    pickup = _local("2026-10-24T10:00:00", ROME)
    drop = _local("2026-10-26T10:00:00", ROME)
    seat = ExtraSelection(code="seat", name="Child seat", quantity=1, unit_price=Decimal("5.00"), price_unit="PER_DAY")

    def total(**kwargs):
        return calculate_price_breakdown(
            Decimal("40.00"), pickup, drop, place, place,
            short_term_threshold_days=0, short_term_fee=Decimal("0"), airport_change_fee=Decimal("0"),
            extras=[seat], **kwargs,
        )

    old, new = total(), total(timezone_name=ROME)

    assert old.base_amount == Decimal("120.00")  # three days, by elapsed hours
    assert new.base_amount == Decimal("80.00")  # two days on the clock
    # The add-on is per day over the same number of days.
    assert new.total_amount == Decimal("90.00") and old.total_amount == Decimal("135.00")


def test_a_quote_counts_days_on_the_clock_at_the_pickup_place():
    """End to end: the same two instants are three days at a place in UTC and two
    days at a place in Rome, because the Roman clocks went back in between."""

    from fastapi.testclient import TestClient

    from app.database import SessionLocal
    from app.main import app
    from app.models import Location
    from tests.test_reservations import ensure_car_available, get_location_id

    client = TestClient(app)
    aho = get_location_id("AHO")
    car = ensure_car_available("SA-008-AA")

    db = SessionLocal()
    try:
        location = db.get(Location, __import__("uuid").UUID(aho))
        original = location.timezone
    finally:
        db.close()

    def set_zone(name):
        db = SessionLocal()
        try:
            db.get(Location, __import__("uuid").UUID(aho)).timezone = name
            db.commit()
        finally:
            db.close()

    def quote():
        response = client.post(
            "/api/reservations/quote",
            json={
                "car_id": car["id"],
                "pickup_location_id": aho,
                "return_location_id": aho,
                # Saturday 10:00 and Monday 10:00 in Rome: 08:00 and 09:00 in UTC.
                "pickup_at": "2030-10-26T08:00:00Z",
                "return_at": "2030-10-28T09:00:00Z",
            },
        )
        assert response.status_code == 200, response.text

        return response.json()

    try:
        set_zone("UTC")
        in_utc = quote()

        set_zone("Europe/Rome")
        in_rome = quote()

        assert in_utc["rental_days"] == 3
        assert in_rome["rental_days"] == 2
        assert Decimal(str(in_rome["total_amount"])) < Decimal(str(in_utc["total_amount"]))
    finally:
        set_zone(original)
