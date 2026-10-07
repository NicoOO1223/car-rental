"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";

import {
  formatCalendarDate,
  formatCurrencyCompact,
  getLocale,
  todayInZone,
} from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * A single-month range calendar for picking the rental period.
 *
 * Hand-rolled rather than pulled from a library: the project has four
 * runtime dependencies and no date library, and a range picker with this
 * little behaviour is not worth the bundle or the styling fight.
 *
 * All dates are handled as plain calendar days in `yyyy-mm-dd` form. There
 * is deliberately no Date-to-UTC conversion anywhere in here — a rental on
 * the 14th means the 14th at the counter, and going through toISOString()
 * would shift it a day for anyone west of Greenwich. Which day "today" is
 * comes from the caller (the pickup location's timezone), not from the
 * viewer's clock.
 *
 * The first day of the week and the weekday and month names follow the
 * business locale.
 */

/** 0 = Sunday ... 6 = Saturday: the day the week starts on in this locale. */
function weekStart(): number {
  try {
    const tag = getLocale() ?? navigator.language;
    // A bare "en" would resolve to United States rules (Sunday first). The
    // plain-English choice has always meant Monday-first here, so it keeps
    // that; pick "English (United States)" for Sunday.
    const locale = new Intl.Locale(tag === "en" ? "en-GB" : tag) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;

    // Intl numbers days 1 (Monday) to 7 (Sunday).
    if (info) return info.firstDay % 7;
  } catch {
    // Fall through to Monday.
  }

  return 1;
}

/** Short weekday names starting from the locale's first day of the week. */
function weekdayLabels(firstDay: number): string[] {
  const formatter = new Intl.DateTimeFormat(getLocale(), {
    weekday: "short",
    timeZone: "UTC",
  });

  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, index) =>
    formatter
      .format(new Date(Date.UTC(2024, 0, 7 + ((firstDay + index) % 7), 12)))
      .slice(0, 2),
  );
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function fromDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Day cells for one month, padded to whole weeks starting on `firstDay`. */
function monthCells(year: number, month: number, firstDay: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-first; shift so the locale's first day is column 0.
  const offset = (first.getDay() - firstDay + 7) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = Array(offset).fill(null);

  for (let day = 1; day <= dayCount; day++) {
    cells.push(new Date(year, month, day));
  }

  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(getLocale(), {
    month: "long",
    year: "numeric",
  });
}

export function DateRangeCalendar({
  pickupDate,
  returnDate,
  onChange,
  dayCount = 0,
  dayPrices,
  todayKey,
}: {
  pickupDate: string;
  returnDate: string;
  onChange: (next: { pickupDate: string; returnDate: string }) => void;
  /**
   * Chargeable days, passed in rather than derived from the two dates
   * here: the real duration depends on the pickup and drop-off *times*,
   * which this component does not own. Same-date arithmetic would
   * disagree with the invoice whenever the drop-off is later in the day.
   */
  dayCount?: number;
  /**
   * Day rate per date key, shown under each day. Optional: without it the
   * calendar is unchanged. Comes from the server so date-specific pricing
   * shows up here without any change to this component.
   */
  dayPrices?: Record<string, number>;
  /**
   * Today as a date key in the timezone of the place being booked, so the
   * first selectable day is the counter's today. Defaults to the business's.
   */
  todayKey?: string;
}) {
  const today = useMemo(
    () => fromDateKey(todayKey ?? todayInZone()),
    [todayKey],
  );
  const firstDay = useMemo(() => weekStart(), []);
  const weekdays = useMemo(() => weekdayLabels(firstDay), [firstDay]);

  const [viewStart, setViewStart] = useState(() => {
    const anchor = pickupDate ? fromDateKey(pickupDate) : today;
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });

  // Previews the range while the pointer moves between the two clicks, so
  // choosing the second date is not a guess.
  const [hoverKey, setHoverKey] = useState("");

  const year = viewStart.getFullYear();
  const month = viewStart.getMonth();

  // Nothing before the current month is reachable, so hide the control
  // rather than leaving a button that does nothing.
  const canGoBack =
    viewStart.getFullYear() > today.getFullYear() ||
    (viewStart.getFullYear() === today.getFullYear() &&
      viewStart.getMonth() > today.getMonth());

  function shiftMonths(delta: number) {
    setViewStart(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  }

  function handleDayClick(key: string) {
    // Nothing picked yet, or a finished range being replaced: this click
    // starts a new one.
    if (!pickupDate || returnDate) {
      onChange({ pickupDate: key, returnDate: "" });
      setHoverKey("");
      return;
    }

    // Second click closes the range in whichever direction it was drawn.
    // Picking the 28th and then the 20th means 20 to 28, not a discarded
    // first pick — people scanning a month often land on the end date
    // first.
    if (key < pickupDate) {
      onChange({ pickupDate: key, returnDate: pickupDate });
    } else {
      onChange({ pickupDate, returnDate: key });
    }

    setHoverKey("");
  }

  // With only one end chosen, the hovered day previews the other, in
  // whichever direction it lies.
  const rangeStart = returnDate
    ? pickupDate
    : pickupDate && hoverKey && hoverKey < pickupDate
      ? hoverKey
      : pickupDate;

  const rangeEnd = returnDate
    ? returnDate
    : pickupDate && hoverKey && hoverKey > pickupDate
      ? hoverKey
      : pickupDate && hoverKey && hoverKey < pickupDate
        ? pickupDate
        : "";

  return (
    // Spans the form like every other field. A centred panel left the
    // "Rental dates" label stranded far from the control it labels.
    <div className="w-full overflow-hidden rounded-xl border border-border-subtle bg-surface">
      <div className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonths(-1)}
          disabled={!canGoBack}
          aria-label={t("c.booking.DateRangeCalendar.previousMonth")}
          className="rounded-lg p-1.5 text-ink-secondary transition hover:bg-surface-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <p aria-live="polite" className="text-sm font-semibold text-ink">
          {monthLabel(year, month)}
        </p>

        <button
          type="button"
          onClick={() => shiftMonths(1)}
          aria-label={t("c.booking.DateRangeCalendar.nextMonth")}
          className="rounded-lg p-1.5 text-ink-secondary transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div onMouseLeave={() => setHoverKey("")}>
        <div className="grid grid-cols-7 gap-y-1">
          {weekdays.map((weekday) => (
            <div
              key={weekday}
              aria-hidden="true"
              className="pb-2 text-center text-xs font-medium text-ink-muted"
            >
              {weekday}
            </div>
          ))}

          {monthCells(year, month, firstDay).map((date, index) => {
            if (!date) {
              return <div key={`pad-${index}`} aria-hidden="true" />;
            }

            const key = toDateKey(date);
            const isPast = date < today;
            const isPickup = key === pickupDate;
            const isReturn = key === returnDate;
            const isEnd = isPickup || isReturn;
            const isToday = key === toDateKey(today);

            // Everything between the two ends gets the fill. The chosen
            // ends are painted separately, so they are excluded; a
            // hovered preview end is not an end yet and so is filled.
            const inRange =
              Boolean(rangeStart) &&
              Boolean(rangeEnd) &&
              key >= rangeStart &&
              key <= rangeEnd &&
              !isEnd;

            // Round only the outer edges, so the selection reads as a
            // single bar spanning the days rather than a row of separate
            // blocks — which is what it looked like once the cells got
            // this wide.
            const hasSpan = Boolean(pickupDate) && Boolean(returnDate);
            const endRadius = !hasSpan
              ? "rounded-lg"
              : pickupDate === returnDate
                ? "rounded-lg"
                : isPickup
                  ? "rounded-l-lg"
                  : "rounded-r-lg";

            return (
              <button
                key={key}
                type="button"
                disabled={isPast}
                onClick={() => handleDayClick(key)}
                onMouseEnter={() => setHoverKey(key)}
                onFocus={() => setHoverKey(key)}
                aria-pressed={isEnd}
                aria-label={date.toLocaleDateString(getLocale(), {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                className={`relative ${dayPrices ? "h-12" : "h-11"} text-sm transition focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ink ${
                  isPast ? "cursor-not-allowed text-border-strong" : "cursor-pointer"
                } ${
                  isEnd
                    ? `${endRadius} bg-accent font-semibold text-on-accent`
                    : inRange
                      ? "bg-surface-sunken text-ink"
                      : !isPast
                        ? "rounded-lg text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                        : ""
                }`}
              >
                {dayPrices ? (
                  <span className="flex flex-col items-center leading-tight">
                    <span>{date.getDate()}</span>

                    {!isPast && dayPrices[key] !== undefined && (
                      <span
                        className={`text-[10px] font-normal ${
                          isEnd ? "text-on-accent/70" : "text-ink-muted"
                        }`}
                      >
                        {formatCurrencyCompact(dayPrices[key])}
                      </span>
                    )}
                  </span>
                ) : (
                  date.getDate()
                )}

                {isToday && !isEnd && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-1 mx-auto h-1 w-1 rounded-full bg-accent"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
      </div>

      {/* The chosen range, read back in words inside the same panel, so
          the selection is confirmed somewhere other than the shading. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle bg-surface-sunken px-4 py-3 text-sm">
        <span className="font-medium text-ink">
          {pickupDate ? formatCalendarDate(pickupDate) : t("c.booking.DateRangeCalendar.pickStartDate")}
        </span>

        <ArrowRight
          className="h-4 w-4 shrink-0 text-ink-muted"
          aria-hidden="true"
        />

        <span className={returnDate ? "font-medium text-ink" : "text-ink-muted"}>
          {returnDate ? formatCalendarDate(returnDate) : t("c.booking.DateRangeCalendar.pickDropOffDate")}
        </span>

        {dayCount > 0 && (
          <span className="ml-auto text-ink-muted">{t("duration.days", { count: dayCount })}</span>
        )}
      </div>
    </div>
  );
}
