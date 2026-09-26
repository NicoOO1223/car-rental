"""
The one place that turns instants into calendar days.

Everything stored is an instant (UTC). What a "day" means, though, depends
on where: a rental picked up at 23:30 in Sardinia is on that day for the
staff there, even though it is already the next day in UTC. Every place that
asks "what is today", "which day does this fall on" or "when does this day
start and end" goes through here, using the business's timezone (from
Configuration) or a location's own.

Defaults keep behaviour identical to before this existed: an unset or
unrecognised timezone means UTC.
"""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.services.configuration import get_configuration

UTC = ZoneInfo("UTC")


def zone(name: str | None) -> ZoneInfo:
    """A ZoneInfo for an IANA name; UTC if it is empty or not recognised, so
    a bad value in the database can never take a page down."""

    if not name:
        return UTC

    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def business_zone(db: Session) -> ZoneInfo:
    return zone(get_configuration(db).timezone)


def local_today(tz: ZoneInfo, now: datetime | None = None) -> date:
    """The calendar date it is right now in this timezone."""

    return (now or datetime.now(timezone.utc)).astimezone(tz).date()


def local_date(instant: datetime, tz: ZoneInfo) -> date:
    """Which calendar day an instant falls on in this timezone. A naive
    datetime is taken to be UTC, which is what the app has always stored."""

    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)

    return instant.astimezone(tz).date()


def day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """
    [start, end) of a calendar day as instants. The end is the next local
    midnight, computed on the calendar rather than by adding 24 hours, so a
    day with a daylight-saving change is 23 or 25 hours long, as it really is.
    """

    start = datetime.combine(day, time.min, tzinfo=tz)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)

    return start, end


def range_bounds(first: date, last: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """[start of first day, end of last day) as instants."""

    return day_bounds(first, tz)[0], day_bounds(last, tz)[1]


def assume_zone(value: datetime, tz: ZoneInfo) -> datetime:
    """A datetime with no timezone is what someone typed at the counter, so
    it means local time in this zone. One that already has a timezone is
    left alone."""

    if value.tzinfo is None:
        return value.replace(tzinfo=tz)

    return value
