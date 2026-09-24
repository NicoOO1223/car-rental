/**
 * Shared date, time and money formatting.
 *
 * Every list and detail page used to define its own formatDate /
 * formatTime / formatDateTime, and they had drifted: some used a bare
 * toLocaleDateString, others a short-month form, so the same timestamp
 * read differently depending on which page you were on.
 */

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(value: string | Date): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/** Short form for dense contexts like timeline axes. */
export function formatDateShort(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

// The business currency (configuration.default_currency), set once after
// login by components/CurrencyProvider.tsx. Money shown without an explicit
// currency uses it, so changing it in the Configuration panel changes what
// every screen displays.
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

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

/** "€45" — whole-unit price for tight spaces such as calendar cells. */
export function formatCurrencyCompact(
  amount: number | string,
  currency: string = defaultCurrency,
): string {
  const value = typeof amount === "string" ? Number(amount) : amount;

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Whole days between two instants, rounded up, matching
 * calculate_rental_duration_days in backend/app/services/pricing.py.
 * Used only for labels — every amount shown to a user comes from the
 * server's quote, never from arithmetic done here.
 */
export function rentalDays(pickupAt: string, returnAt: string): number {
  const ms = new Date(returnAt).getTime() - new Date(pickupAt).getTime();

  if (!Number.isFinite(ms) || ms <= 0) return 0;

  return Math.ceil(ms / 86_400_000);
}

/** "3 days" / "1 day". */
export function formatDuration(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * ISO instant to the value a datetime-local input expects, in the
 * viewer's own timezone.
 */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** The inverse: a datetime-local value back to an ISO instant. */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
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

/** "14:30" rendered in the viewer's locale, so 12-hour regions see 2:30 PM. */
export function formatTimeSlot(slot: string): string {
  const [hour, minute] = slot.split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);

  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Today as a date-input value, for `min` attributes. */
export function todayInputValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;

  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
