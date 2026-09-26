// Wall-clock times at a place, and the instants they mean. A renter picks a car
// up at 10:00 where the car is, not at 10:00 where their browser is.

/** Pickup and drop-off times, on the half hour. */
export const TIME_SLOTS: string[] = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");

  return `${hour}:${index % 2 === 0 ? "00" : "30"}`;
});

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function readParts(date: Date, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  const out: Record<string, number> = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }

  return { year: out.year, month: out.month, day: out.day, hour: out.hour === 24 ? 0 : out.hour, minute: out.minute };
}

/** How far ahead of UTC the clocks in a zone are at an instant, in minutes. */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = readParts(date, timeZone);

  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000;
}

/**
 * The instant at which the clocks in `timeZone` read `date` ("2040-06-15") and
 * `time` ("10:00"), as an ISO string. A time that does not exist (the clocks
 * skipped it) lands just after the change; one that happens twice takes the
 * later occurrence.
 */
export function zonedToInstant(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // The offset depends on the answer, so refine once: guess with the offset at
  // the wall-clock moment, then correct with the offset at the guess.
  const first = offsetMinutes(new Date(wallClockAsUtc), timeZone);
  let instant = wallClockAsUtc - first * 60_000;
  const second = offsetMinutes(new Date(instant), timeZone);

  if (second !== first) instant = wallClockAsUtc - second * 60_000;

  return new Date(instant).toISOString();
}

/** The date and time the clocks in `timeZone` show at an instant. */
export function instantToZoned(iso: string | Date, timeZone: string): { date: string; time: string } {
  const p = readParts(new Date(iso), timeZone);
  const two = (n: number) => String(n).padStart(2, "0");

  return { date: `${p.year}-${two(p.month)}-${two(p.day)}`, time: `${two(p.hour)}:${two(p.minute)}` };
}

/** A date ("2040-06-15") moved by a number of days. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));

  return moved.toISOString().slice(0, 10);
}
