"""
seed_test_client.py fills the crash-test stack. It must be impossible to point it at the wrong
database by accident, and the plan it builds must hold the shape the testers rely on.
Importing the module is safe: it only imports the app inside main().
"""

import random
from collections import Counter
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import pytest

import seed_test_client as seed

GOOD_URL = "postgresql+psycopg://user:pw@host:5432/car_rental"
TODAY = date(2026, 10, 9)


def _environment(monkeypatch, *, url=GOOD_URL, secret="x", storage="https://account.blob.core.windows.net"):
    monkeypatch.setenv("CRASHTEST_DATABASE_URL", url) if url else monkeypatch.delenv("CRASHTEST_DATABASE_URL", raising=False)
    monkeypatch.setenv("SECRET_KEY", secret) if secret else monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_URL", storage) if storage else monkeypatch.delenv("AZURE_STORAGE_ACCOUNT_URL", raising=False)


def test_runs_when_everything_is_set(monkeypatch):
    _environment(monkeypatch)

    seed.refuse_unless_safe(stack="crashtest")  # no exit


def test_refuses_without_its_own_database_url(monkeypatch):
    _environment(monkeypatch, url=None)
    monkeypatch.setenv("DATABASE_URL", GOOD_URL)  # the app's own URL is never used

    with pytest.raises(SystemExit) as stopped:
        seed.refuse_unless_safe(stack="crashtest")

    assert "CRASHTEST_DATABASE_URL" in str(stopped.value)


@pytest.mark.parametrize("stack", [None, "", "demo", "Crashtest"])
def test_refuses_the_wrong_stack(monkeypatch, stack):
    _environment(monkeypatch)

    with pytest.raises(SystemExit) as stopped:
        seed.refuse_unless_safe(stack=stack)

    assert "--stack crashtest" in str(stopped.value)


def test_refuses_without_a_secret_key(monkeypatch):
    _environment(monkeypatch, secret=None)

    with pytest.raises(SystemExit):
        seed.refuse_unless_safe(stack="crashtest")


def test_refuses_to_write_photos_to_local_disk(monkeypatch):
    _environment(monkeypatch, storage=None)

    with pytest.raises(SystemExit) as stopped:
        seed.refuse_unless_safe(stack="crashtest")

    assert "AZURE_STORAGE_ACCOUNT_URL" in str(stopped.value)
    seed.refuse_unless_safe(stack="crashtest", storage_required=False)  # --no-photos


def test_wipe_needs_the_stack_name_typed(monkeypatch):
    _environment(monkeypatch)
    monkeypatch.setattr("builtins.input", lambda _prompt: "yes")

    with pytest.raises(SystemExit):
        seed.refuse_unless_safe(stack="crashtest", wipe=True)

    monkeypatch.setattr("builtins.input", lambda _prompt: "crashtest")
    seed.refuse_unless_safe(stack="crashtest", wipe=True)


# ---- the plan


@pytest.fixture(scope="module")
def plan():
    return seed.build_plan(random.Random(1), TODAY, seed.real_emails(["a@example.org", "b@example.org"]))


def test_the_same_seed_gives_the_same_plan():
    first = seed.build_plan(random.Random(5), TODAY, [])
    second = seed.build_plan(random.Random(5), TODAY, [])

    assert [(b.pickup, b.car, b.person) for b in first.bookings] == [(b.pickup, b.car, b.person) for b in second.bookings]


def test_the_fleet_and_places_line_up():
    assert len(seed.FLEET) == len(seed.HOMES) == 26
    assert Counter(seed.HOMES) == {"SPU": 10, "DBV": 9, "ZAD": 7}
    assert {row[0] for row in seed.FLEET} == {c[0] for c in seed.CLASSES}
    assert {row[4] for row in seed.FLEET} >= {"ECONOMY", "COMPACT", "SUV", "PREMIUM", "VAN"}
    assert {row[6] for row in seed.FLEET} == {"PETROL", "DIESEL", "HYBRID", "ELECTRIC"}


def test_there_are_150_requests_in_the_next_90_days(plan):
    zone = ZoneInfo(seed.BUSINESS_TZ)
    assert len(plan.bookings) == seed.RESERVATIONS == 150

    for booking in plan.bookings:
        pickup_day = booking.pickup.astimezone(zone).date()
        assert TODAY < pickup_day <= TODAY + timedelta(days=seed.WINDOW_DAYS)
        assert booking.ret > booking.pickup


def test_a_pickup_is_where_the_car_lives(plan):
    for booking in plan.bookings:
        if booking.car is not None:
            assert booking.pickup_code == seed.HOMES[booking.car]
            assert booking.klass == seed.FLEET[booking.car][0]
        else:
            # A class booking is at a place that has a car of the class.
            assert any(seed.HOMES[i] == booking.pickup_code for i, row in enumerate(seed.FLEET) if row[0] == booking.klass)


def test_about_15_percent_are_for_a_class_with_no_car(plan):
    share = sum(1 for b in plan.bookings if b.car is None) / len(plan.bookings)

    assert 0.08 <= share <= 0.22


def test_some_return_elsewhere_some_are_short_some_have_extras(plan):
    assert 0.15 <= sum(1 for b in plan.bookings if b.return_code != b.pickup_code) / len(plan.bookings) <= 0.35
    assert sum(1 for b in plan.bookings if (b.ret - b.pickup).days < seed.DURATIONS[4]) > 40
    assert 0.18 <= sum(1 for b in plan.bookings if b.extras) / len(plan.bookings) <= 0.42


def test_a_few_cars_have_overlapping_requests(plan):
    by_car = {}

    for booking in plan.bookings:
        if booking.car is not None:
            by_car.setdefault(booking.car, []).append(booking)

    def overlaps(rows):
        rows = sorted(rows, key=lambda b: b.pickup)
        return sum(1 for a, b in zip(rows, rows[1:]) if b.pickup < a.ret)

    assert sum(1 for rows in by_car.values() if overlaps(rows) >= 3) >= seed.HOT_CARS - 1


def test_requests_arrived_recently_and_some_are_overdue_for_the_24_hour_rule(plan):
    ages = [b.created_hours_ago for b in plan.bookings]

    assert sum(1 for age in ages if age < 6) >= 10
    assert sum(1 for age in ages if 24 < age <= 60) >= 15
    assert sum(1 for age in ages if age > 60) >= 5
    assert min(ages) > 0


def test_people_include_repeat_customers_and_the_real_inboxes(plan):
    booked = Counter(b.person for b in plan.bookings)

    assert len(plan.people) == 110
    assert len(booked) == 110
    assert sum(1 for n in booked.values() if n > 1) >= 20
    assert [p.email for p in plan.people if p.real] == ["a@example.org", "b@example.org", "a+adr3@example.org", "b+adr4@example.org", "a+adr5@example.org", "b+adr6@example.org"]
    assert all(p.email.endswith("@example.com") for p in plan.people if not p.real)


def test_every_real_renter_has_a_booking(plan):
    real = {i for i, p in enumerate(plan.people) if p.real}

    assert real <= {b.person for b in plan.bookings}


def test_real_emails_without_addresses_gives_no_real_renters():
    assert seed.real_emails([]) == []
    assert not any(p.real for p in seed.build_plan(random.Random(2), TODAY, []).people)


def test_each_pair_of_names_is_used_once(plan):
    pairs = [(p.first_name, p.last_name) for p in plan.people]

    assert len(pairs) == len(set(pairs))


def test_plates_are_unique_and_tied_to_the_home_town():
    taken: set[str] = set()
    rng = random.Random(3)
    plates = [seed.plate_for(i, rng, taken) for i in range(len(seed.FLEET))]

    assert len(set(plates)) == len(plates)
    assert all(plate.split(" ")[0] == seed.PLATE_PREFIX[seed.HOMES[i]] for i, plate in enumerate(plates))
