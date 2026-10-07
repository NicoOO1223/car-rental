import { describe, expect, it } from "vitest";

import { parseSort, sortOptions, sortParam } from "@/lib/serverSort";

// The reservations list: the Rental column sorts by pickup, Booked by when it was made.
const KEYS = { customer: "customer", rental: "pickup", booked: "created", last: "last_booking" };

describe("parseSort", () => {
  it("reads the column and direction a parameter means", () => {
    expect(parseSort("pickup_asc", KEYS)).toEqual({ columnId: "rental", direction: "asc" });
    expect(parseSort("created_desc", KEYS)).toEqual({ columnId: "booked", direction: "desc" });
  });

  it("copes with a key that itself contains an underscore", () => {
    expect(parseSort("last_booking_desc", KEYS)).toEqual({ columnId: "last", direction: "desc" });
  });

  it("gives null for an order no column of this table shows", () => {
    expect(parseSort("return_asc", KEYS)).toBeNull();
    expect(parseSort("recent", KEYS)).toBeNull();
    expect(parseSort("pickup_sideways", KEYS)).toBeNull();
    expect(parseSort("", KEYS)).toBeNull();
  });
});

describe("sortParam", () => {
  it("names the order for a header's state", () => {
    expect(sortParam({ columnId: "rental", direction: "desc" }, KEYS, "pickup_asc")).toBe("pickup_desc");
  });

  it("goes back to the default when the sort is cleared or the column is unknown", () => {
    expect(sortParam(null, KEYS, "pickup_asc")).toBe("pickup_asc");
    expect(sortParam({ columnId: "status", direction: "asc" }, KEYS, "pickup_asc")).toBe("pickup_asc");
  });

  it("round-trips with parseSort", () => {
    for (const param of ["customer_asc", "pickup_desc", "created_asc", "last_booking_desc"]) {
      expect(sortParam(parseSort(param, KEYS), KEYS, "x")).toBe(param);
    }
  });
});

describe("sortOptions", () => {
  it("lists both directions of every sortable column", () => {
    const columns = [
      { id: "customer", header: "Customer" },
      { id: "rental", header: "Rental" },
      { id: "status", header: "Status" },
    ];

    expect(sortOptions(columns, KEYS)).toEqual([
      { value: "customer_asc", label: "Customer ↑" },
      { value: "customer_desc", label: "Customer ↓" },
      { value: "pickup_asc", label: "Rental ↑" },
      { value: "pickup_desc", label: "Rental ↓" },
    ]);
  });
});
