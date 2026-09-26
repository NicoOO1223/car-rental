import { afterEach, describe, expect, it } from "vitest";

import {
  addDays,
  bookingReference,
  instantToZoned,
  rentalDays,
  setBusinessTimeZone,
  todayInZone,
  zonedToInstant,
} from "@/lib/format";

afterEach(() => setBusinessTimeZone(undefined));

describe("wall-clock time in a zone", () => {
  it("turns 10:00 at a place into the right instant, across a clock change", () => {
    // Rome is UTC+2 in June and UTC+1 in January.
    expect(zonedToInstant("2040-06-15", "10:00", "Europe/Rome")).toBe("2040-06-15T08:00:00.000Z");
    expect(zonedToInstant("2040-01-15", "10:00", "Europe/Rome")).toBe("2040-01-15T09:00:00.000Z");
  });

  it("reads an instant back as the same wall-clock time", () => {
    const parts = instantToZoned("2040-06-15T08:00:00.000Z", "Europe/Rome");

    expect(parts).toEqual({ date: "2040-06-15", time: "10:00" });
  });

  it("says what day it is at the business, not in UTC", () => {
    setBusinessTimeZone("Pacific/Auckland");

    expect(todayInZone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("dates and references", () => {
  it("adds days to a calendar date without touching the clock", () => {
    expect(addDays("2040-02-28", 2)).toBe("2040-03-01");
    expect(addDays("2040-12-31", 1)).toBe("2041-01-01");
    expect(addDays("2040-03-01", -1)).toBe("2040-02-29");
  });

  it("counts rental days from pickup and return", () => {
    expect(rentalDays("2040-06-15T08:00:00Z", "2040-06-18T08:00:00Z")).toBe(3);
  });

  it("shortens an id to the booking reference staff read out", () => {
    expect(bookingReference("3c1083eb-9986-43f3-89da-75992695e711")).toBe("3C1083EB");
  });
});
