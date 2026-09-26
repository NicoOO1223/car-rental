// Checks the timezone conversion helpers in lib/format.ts against known
// offsets and clock changes. The frontend has no test runner, so run this
// by hand after touching them (Node 22.6 or newer runs TypeScript directly):
//   node scripts/check-format.mts
import { zonedToInstant, instantToZoned, addDays, isoToLocalInput, localInputToIso, formatTimeSlot, setLocale, formatCurrency, formatCalendarDate } from "../lib/format.ts";

let failures = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

eq("Rome summer", zonedToInstant("2040-06-15", "10:00", "Europe/Rome"), "2040-06-15T08:00:00.000Z");
eq("Rome winter", zonedToInstant("2040-01-15", "10:00", "Europe/Rome"), "2040-01-15T09:00:00.000Z");
eq("Auckland", zonedToInstant("2040-06-15", "10:00", "Pacific/Auckland"), "2040-06-14T22:00:00.000Z");
eq("Kiritimati", zonedToInstant("2040-06-15", "00:10", "Pacific/Kiritimati"), "2040-06-14T10:10:00.000Z");
eq("New York summer", zonedToInstant("2040-07-04", "09:30", "America/New_York"), "2040-07-04T13:30:00.000Z");
eq("Kolkata half hour", zonedToInstant("2040-06-15", "10:00", "Asia/Kolkata"), "2040-06-15T04:30:00.000Z");
eq("UTC", zonedToInstant("2040-06-15", "10:00", "UTC"), "2040-06-15T10:00:00.000Z");

// Clock changes: Rome springs forward 2040-03-25 02:00 -> 03:00, falls back 2040-10-28 03:00 -> 02:00.
eq("Rome before spring change", zonedToInstant("2040-03-25", "01:30", "Europe/Rome"), "2040-03-25T00:30:00.000Z");
eq("Rome after spring change", zonedToInstant("2040-03-25", "03:30", "Europe/Rome"), "2040-03-25T01:30:00.000Z");
eq("Rome skipped 02:30 lands just after the gap", zonedToInstant("2040-03-25", "02:30", "Europe/Rome"), "2040-03-25T01:30:00.000Z");
eq("Rome autumn ambiguous 02:30 takes the later", zonedToInstant("2040-10-28", "02:30", "Europe/Rome"), "2040-10-28T01:30:00.000Z");
eq("Rome day after autumn change", zonedToInstant("2040-10-28", "12:00", "Europe/Rome"), "2040-10-28T11:00:00.000Z");

// Round trips.
for (const zone of ["Europe/Rome", "Pacific/Auckland", "America/New_York", "Asia/Kolkata", "Pacific/Kiritimati", "UTC"]) {
  const iso = zonedToInstant("2040-05-05", "17:30", zone);
  eq(`round trip ${zone}`, instantToZoned(iso, zone), { date: "2040-05-05", time: "17:30" });
}

eq("instantToZoned crosses the date line", instantToZoned("2040-06-14T22:00:00Z", "Pacific/Auckland"), { date: "2040-06-15", time: "10:00" });
eq("addDays month end", addDays("2040-01-31", 1), "2040-02-01");
eq("addDays negative", addDays("2040-03-01", -1), "2040-02-29");
eq("input helpers", localInputToIso(isoToLocalInput("2040-06-15T08:00:00Z", "Europe/Rome"), "Europe/Rome"), "2040-06-15T08:00:00.000Z");

setLocale("en-US");
eq("slot en-US", formatTimeSlot("14:30").replace(/ /g, " "), "02:30 PM");
setLocale("de");
eq("slot de", formatTimeSlot("14:30"), "14:30");
eq("currency de", formatCurrency(1234.5, "EUR").replace(/ /g, " "), "1.234,50 €");
eq("calendar date de", formatCalendarDate("2040-06-15"), "15. Juni 2040");

process.exit(failures ? 1 : 0);
