"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";

import { formatCurrencyCompact, formatDate } from "@/lib/format";

/**
 * A single-month range calendar for picking the rental period.
 *
 * Hand-rolled rather than pulled from a library: the project has four
 * runtime dependencies and no date library, and a range picker with this
 * little behaviour is not worth the bundle or the styling fight.
 *
 * All dates are handled as local calendar days in `yyyy-mm-dd` form. There
 * is deliberately no Date-to-UTC conversion anywhere in here — a rental on
 * the 14th means the 14th at the counter, and going through toISOString()
 * would shift it a day for anyone west of Greenwich.
 */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

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

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/** Day cells for one month, padded to whole Monday-start weeks. */
function monthCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-first; shift so Monday is column 0.
  const offset = (first.getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = Array(offset).fill(null);

  for (let day = 1; day <= dayCount; day++) {
    cells.push(new Date(year, month, day));
  }

  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
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
}) {
  const today = useMemo(() => startOfToday(), []);

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
          aria-label="Previous month"
          className="rounded-lg p-1.5 text-ink-secondary transition hover:bg-surface-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <p aria-live="polite" className="text-sm font-semibold text-ink">
          {monthLabel(year, month)}
        </p>

        <button
          type="button"
          onClick={() => shiftMonths(1)}
          aria-label="Next month"
          className="rounded-lg p-1.5 text-ink-secondary transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div onMouseLeave={() => setHoverKey("")}>
        <div className="grid grid-cols-7 gap-y-1">
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday}
              aria-hidden="true"
              className="pb-2 text-center text-xs font-medium text-ink-muted"
            >
              {weekday}
            </div>
          ))}

          {monthCells(year, month).map((date, index) => {
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
                aria-label={date.toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                className={`relative ${dayPrices ? "h-12" : "h-11"} text-sm transition focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900 ${
                  isPast ? "cursor-not-allowed text-gray-300" : "cursor-pointer"
                } ${
                  isEnd
                    ? `${endRadius} bg-gray-900 font-semibold text-white`
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
                          isEnd ? "text-white/70" : "text-ink-muted"
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
                    className="absolute inset-x-0 bottom-1 mx-auto h-1 w-1 rounded-full bg-gray-900"
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
          {pickupDate ? formatDate(pickupDate) : "Pick a start date"}
        </span>

        <ArrowRight
          className="h-4 w-4 shrink-0 text-ink-muted"
          aria-hidden="true"
        />

        <span className={returnDate ? "font-medium text-ink" : "text-ink-muted"}>
          {returnDate ? formatDate(returnDate) : "Pick a drop-off date"}
        </span>

        {dayCount > 0 && (
          <span className="ml-auto text-ink-muted">
            {dayCount} day{dayCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
