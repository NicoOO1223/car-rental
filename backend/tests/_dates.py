"""
Days ahead for tests that book a shared seeded car.

Tests used to draw `far_future_days()` for a pickup, so two bookings
of the same car could land on overlapping days by chance, and the more
reservations one run made, the likelier it got. That is a flaky test, not a
bug. This hands out a different slot for every call in a run: a random
starting point (so one run does not collide with what an earlier run left
behind) that then only moves forward, four days at a time, which is wider
than the longest booking any of these tests makes.
"""

import itertools
import random

_SLOT_DAYS = 4
_first = random.randint(3000, 4500)
_slots = itertools.count()


def far_future_days() -> int:
    """A number of days from now that no earlier call in this run returned or overlaps."""

    return _first + next(_slots) * _SLOT_DAYS
