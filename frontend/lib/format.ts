/**
 * Shared date, time and money formatting.
 *
 * Every list and detail page used to define its own formatDate /
 * formatTime / formatDateTime, and they had drifted: some used a bare
 * toLocaleDateString, others a short-month form, so the same timestamp
 * read differently depending on which page you were on.
 *
 * Two pieces of business state shape everything here, both set once after
 * login by components/CurrencyProvider.tsx:
 *   - the locale, which decides how dates, times and money are written;
 *   - the business timezone, which decides what day and hour a moment is
 *     when no more specific timezone is given.
 * A reservation's pickup and return are the exception: they are shown in
 * the timezone of the location they happen at, which pages pass explicitly.
 * Nothing here uses the viewer's own timezone, so staff on a laptop in
 * another country see the same times as the counter they are managing.
 */

import { t } from "@/lib/i18n";

// --- Business locale and timezone ------------------------------------------

let businessLocale: string | undefined;
let businessTimeZone: string | undefined;

export function setLocale(locale: string | undefined): void {
  businessLocale = locale || undefined;
}

export function getLocale(): string | undefined {
  return businessLocale;
}

export function setBusinessTimeZone(timeZone: string | undefined): void {
  businessTimeZone = timeZone || undefined;
}

export function getBusinessTimeZone(): string | undefined {
  return businessTimeZone;
}

/** A timezone Intl will accept, or undefined (the browser's) if it will not. */
function usableZone(timeZone: string | undefined): string | undefined {
  const candidate = timeZone ?? businessTimeZone;

  if (!candidate) return undefined;

  try {
    new Intl.DateTimeFormat(undefined, { timeZone: candidate });
    return candidate;
  } catch {
    return undefined;
  }
}

// --- Dates and times ----------------------------------------------------------

// "2040-06-15": a calendar day with no time or zone (a birth date, an
// inspection due date). It must not be shifted by any timezone.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(value: string | Date, timeZone?: string): string {
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    return formatCalendarDate(value);
  }

  return new Date(value).toLocaleDateString(businessLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: usableZone(timeZone),
  });
}

export function formatTime(value: string | Date, timeZone?: string): string {
  return new Date(value).toLocaleTimeString(businessLocale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: usableZone(timeZone),
  });
}

export function formatDateTime(value: string | Date, timeZone?: string): string {
  return `${formatDate(value, timeZone)}, ${formatTime(value, timeZone)}`;
}

/**
 * A day and a time on one line, for table cells: "Oct 12, 10:00 AM". The year
 * is left out when it is this year, where it would only be noise.
 */
export function formatDayTime(value: string | Date, timeZone?: string, now: number = Date.now()): string {
  const date = new Date(value);
  const zone = usableZone(timeZone);
  const yearOf = (moment: Date) => moment.toLocaleDateString("en", { year: "numeric", timeZone: zone });
  const sameYear = yearOf(date) === yearOf(new Date(now));

  const day = date.toLocaleDateString(businessLocale, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: zone,
  });

  return `${day}, ${formatTime(date, timeZone)}`;
}

/** Whole hours from a moment until `now` (negative for a moment still to come). */
export function hoursSince(value: string | Date, now: number = Date.now()): number {
  return (now - new Date(value).getTime()) / 3_600_000;
}

/**
 * When something happened, the way a person scanning a list wants it: how
 * long ago while it is recent ("6 hr. ago"), the date once it is older than
 * two days.
 */
export function formatAge(value: string | Date, now: number = Date.now()): string {
  const hours = hoursSince(value, now);

  if (hours < 0 || hours >= 48) return formatDayTime(value, undefined, now).split(",")[0];

  const relative = new Intl.RelativeTimeFormat(businessLocale, { numeric: "always", style: "short" });

  return hours < 1 ? relative.format(-Math.max(1, Math.round(hours * 60)), "minute") : relative.format(-Math.round(hours), "hour");
}

/** Short form for dense contexts like timeline axes. */
export function formatDateShort(value: string | Date, timeZone?: string): string {
  return new Date(value).toLocaleDateString(businessLocale, {
    day: "numeric",
    month: "short",
    timeZone: usableZone(timeZone),
  });
}

/** A calendar date (no time, no zone) such as "2040-06-15", written out. */
export function formatCalendarDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
): string {
  const [year, month, day] = value.split("-").map(Number);

  // Built at noon UTC and formatted in UTC so no zone can shift the day.
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(
    businessLocale,
    { ...options, timeZone: "UTC" },
  );
}

/** Whole numbers with the business locale's grouping, e.g. mileage. */
export function formatNumber(value: number): string {
  return value.toLocaleString(businessLocale);
}

// --- Money -----------------------------------------------------------------

// The business currency (configuration.default_currency), set once after
// login by components/CurrencyProvider.tsx. Money shown without an explicit
// currency uses it, so changing it in the Configuration panel changes what
// every screen displays. EUR only until that first response arrives.
let defaultCurrency = "EUR";

export function setDefaultCurrency(currency: string): void {
  defaultCurrency = currency.toUpperCase();
}

export function getDefaultCurrency(): string {
  return defaultCurrency;
}

export function formatCurrency(
  amount: number | string,
  currency: string = defaultCurrency,
): string {
  const value = typeof amount === "string" ? Number(amount) : amount;

  return new Intl.NumberFormat(businessLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

/** A whole-unit price for tight spaces such as calendar cells. */
export function formatCurrencyCompact(
  amount: number | string,
  currency: string = defaultCurrency,
): string {
  const value = typeof amount === "string" ? Number(amount) : amount;

  return new Intl.NumberFormat(businessLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Rental days, any part of a day counting as a day, matching
 * calculate_rental_duration_days in backend/app/services/pricing.py: counted on
 * the wall clock at the pickup place (`timeZone`), so a rental across the
 * clocks changing is not a day longer than it looks. Without a zone the elapsed
 * time is used. Used only for labels — every amount shown to a user comes from
 * the server's quote, never from arithmetic done here.
 */
export function rentalDays(pickupAt: string, returnAt: string, timeZone?: string): number {
  const start = new Date(pickupAt).getTime();
  const end = new Date(returnAt).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  if (!timeZone) return Math.ceil((end - start) / 86_400_000);

  // The clocks' readings as if they were UTC, so subtracting them is the wall-clock difference.
  const onTheClock = (iso: string) => {
    const { date, time } = instantToZoned(iso, timeZone);
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);

    return Date.UTC(year, month - 1, day, hour, minute, new Date(iso).getUTCSeconds());
  };

  return Math.ceil((onTheClock(returnAt) - onTheClock(pickupAt)) / 86_400_000);
}

/** "3 days" / "1 day". */
export function formatDuration(days: number): string {
  return t("duration.days", { count: days });
}

// --- Converting between wall-clock time in a zone and instants ------------------

type ZonedParts = { date: string; time: string };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, formatter);
  }

  return formatter;
}

/** The zone to convert in: the one given, else the business's, else the browser's. */
function conversionZone(timeZone: string | undefined): string {
  return (
    usableZone(timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
  );
}

function readParts(instant: Date, timeZone: string) {
  const values: Record<string, number> = {};

  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return values;
}

/** How far ahead of UTC a zone's clocks are at a moment, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = readParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);

  // Milliseconds are dropped by the parts, so drop them from the instant too.
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000;
}

/**
 * The instant at which the clocks in `timeZone` read `date` `time`
 * ("2040-06-15", "10:00"). This is how a counter's "10:00 at the airport"
 * becomes a stored moment: the airport's clock decides, not the browser's.
 *
 * A time skipped by a clock change (02:30 on a spring-forward night) maps to
 * the moment just after it; an ambiguous one (repeated when the clocks go
 * back) takes the later of its two occurrences.
 */
export function zonedToInstant(date: string, time: string, timeZone?: string): string {
  const zone = conversionZone(timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // The offset depends on the answer, so refine once: guess with the offset
  // at the wall-clock moment, then correct it with the offset at the guess.
  const firstOffset = offsetMinutes(new Date(wallClockAsUtc), zone);
  let instant = wallClockAsUtc - firstOffset * 60_000;
  const secondOffset = offsetMinutes(new Date(instant), zone);

  if (secondOffset !== firstOffset) {
    instant = wallClockAsUtc - secondOffset * 60_000;
  }

  return new Date(instant).toISOString();
}

/** The date and time the clocks in `timeZone` show at an instant. */
export function instantToZoned(iso: string | Date, timeZone?: string): ZonedParts {
  const zone = conversionZone(timeZone);
  const p = readParts(new Date(iso), zone);
  const two = (n: number) => String(n).padStart(2, "0");

  return {
    date: `${p.year}-${two(p.month)}-${two(p.day)}`,
    time: `${two(p.hour)}:${two(p.minute)}`,
  };
}

/** Today's date ("2040-06-15") in a zone, by default the business's. */
export function todayInZone(timeZone?: string): string {
  return instantToZoned(new Date(), timeZone).date;
}

/** Today as a date-input value, for `min` attributes. */
export function todayInputValue(timeZone?: string): string {
  return todayInZone(timeZone);
}

/** The date `days` after a "YYYY-MM-DD" date, as "YYYY-MM-DD". */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));

  return moved.toISOString().slice(0, 10);
}

/**
 * ISO instant to the value a datetime-local input expects, as the clocks
 * in `timeZone` (default: the business's) show it.
 */
export function isoToLocalInput(iso: string, timeZone?: string): string {
  const { date, time } = instantToZoned(iso, timeZone);

  return `${date}T${time}`;
}

/** The inverse: a datetime-local value, read in `timeZone`, back to an ISO instant. */
export function localInputToIso(value: string, timeZone?: string): string {
  const [date, time] = value.split("T");

  return zonedToInstant(date, time.slice(0, 5), timeZone);
}

/**
 * The short, human-quotable form of a reservation id.
 *
 * Lists and detail pages used to print the full UUID, which is 36
 * unreadable characters that got truncated mid-string anyway. The first
 * block is enough to find a booking and short enough to read aloud.
 */
export function bookingReference(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/**
 * Pickup and drop-off times, on the half hour.
 *
 * A counter opens and closes on the clock, so free-form minutes were
 * never meaningful — the old flow hardcoded every booking to 10:00 UTC
 * rather than ask.
 */
export const TIME_SLOTS: string[] = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  const minute = index % 2 === 0 ? "00" : "30";

  return `${hour}:${minute}`;
});

/** "14:30" written the business's way, so 12-hour locales see 2:30 PM. */
export function formatTimeSlot(slot: string): string {
  const [hour, minute] = slot.split(":").map(Number);
  // A wall-clock time, so it is built and formatted in UTC: no zone can move it.
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));

  return date.toLocaleTimeString(businessLocale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
