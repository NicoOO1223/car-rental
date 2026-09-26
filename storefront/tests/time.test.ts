import { describe, expect, it } from "vitest";

import { TIME_SLOTS, addDays, instantToZoned, zonedToInstant } from "@shared/time";

describe("zonedToInstant", () => {
  it("reads a time at the place, not where the browser is", () => {
    // Rome is two hours ahead of UTC in summer, one in winter.
    expect(zonedToInstant("2040-06-15", "10:00", "Europe/Rome")).toBe("2040-06-15T08:00:00.000Z");
    expect(zonedToInstant("2040-12-15", "10:00", "Europe/Rome")).toBe("2040-12-15T09:00:00.000Z");
    expect(zonedToInstant("2040-06-15", "10:00", "America/New_York")).toBe("2040-06-15T14:00:00.000Z");
  });

  it("handles the clock changes", () => {
    // Skipped hour: 02:30 does not exist in Rome on 31 March 2041.
    expect(zonedToInstant("2041-03-31", "02:30", "Europe/Rome")).toBe("2041-03-31T01:30:00.000Z");
    // The evening before and after are on either side of the change.
    expect(zonedToInstant("2041-03-30", "12:00", "Europe/Rome")).toBe("2041-03-30T11:00:00.000Z");
    expect(zonedToInstant("2041-03-31", "12:00", "Europe/Rome")).toBe("2041-03-31T10:00:00.000Z");
  });

  it("is undone by instantToZoned", () => {
    for (const [date, time, zone] of [
      ["2040-06-15", "10:30", "Europe/Warsaw"],
      ["2040-12-01", "23:30", "Europe/London"],
      ["2040-01-01", "00:00", "Asia/Tokyo"],
    ]) {
      expect(instantToZoned(zonedToInstant(date, time, zone), zone)).toEqual({ date, time });
    }
  });
});

describe("helpers", () => {
  it("offers half-hour slots for the whole day", () => {
    expect(TIME_SLOTS).toHaveLength(48);
    expect(TIME_SLOTS[0]).toBe("00:00");
    expect(TIME_SLOTS[47]).toBe("23:30");
  });

  it("moves a date across month and year ends", () => {
    expect(addDays("2040-01-30", 3)).toBe("2040-02-02");
    expect(addDays("2040-12-31", 1)).toBe("2041-01-01");
    expect(addDays("2040-03-01", -1)).toBe("2040-02-29");
  });
});
