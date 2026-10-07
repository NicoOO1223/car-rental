import { afterEach, describe, expect, it } from "vitest";

import { formatAge, formatDayTime, hoursSince, setBusinessTimeZone, setLocale } from "@/lib/format";

// The helpers behind the list pages' date cells.

const NOW = Date.parse("2040-06-15T12:00:00.000Z");

afterEach(() => {
  setBusinessTimeZone(undefined);
  setLocale(undefined);
});

describe("formatDayTime", () => {
  it("writes a day and a time at the place, without this year's year", () => {
    setLocale("en-GB");

    expect(formatDayTime("2040-06-18T08:00:00.000Z", "Europe/Rome", NOW)).toBe("18 Jun, 10:00");
  });

  it("keeps the year when it is not this year", () => {
    setLocale("en-GB");

    expect(formatDayTime("2041-01-05T09:00:00.000Z", "Europe/Rome", NOW)).toBe("5 Jan 2041, 10:00");
  });
});

describe("hoursSince", () => {
  it("counts hours back from now, and goes negative for the future", () => {
    expect(hoursSince("2040-06-15T06:00:00.000Z", NOW)).toBe(6);
    expect(hoursSince("2040-06-15T13:00:00.000Z", NOW)).toBe(-1);
  });
});

describe("formatAge", () => {
  it("says how long ago for something recent", () => {
    setLocale("en");

    expect(formatAge("2040-06-15T06:00:00.000Z", NOW)).toMatch(/^6 hr\.? ago$/);
    expect(formatAge("2040-06-15T11:40:00.000Z", NOW)).toMatch(/^20 min\.? ago$/);
  });

  it("gives the date once it is older than two days", () => {
    setLocale("en-GB");
    setBusinessTimeZone("Europe/Rome");

    expect(formatAge("2040-06-10T08:00:00.000Z", NOW)).toBe("10 Jun");
  });

  it("never says a moment in the future was some time ago", () => {
    setLocale("en-GB");
    setBusinessTimeZone("Europe/Rome");

    expect(formatAge("2040-06-16T08:00:00.000Z", NOW)).toBe("16 Jun");
  });
});
