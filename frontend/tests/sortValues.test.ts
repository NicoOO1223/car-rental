import { describe, expect, it } from "vitest";

import { compareValues, type SortValue } from "@/lib/sortValues";

const sorted = (values: SortValue[], direction: "asc" | "desc") =>
  [...values].sort((a, b) => compareValues(a, b, direction));

describe("compareValues", () => {
  it("orders numbers, dates and text", () => {
    expect(sorted([30, 4, 12], "asc")).toEqual([4, 12, 30]);
    expect(sorted([30, 4, 12], "desc")).toEqual([30, 12, 4]);

    const june = new Date("2040-06-01");
    const may = new Date("2040-05-01");
    expect(sorted([june, may], "asc")).toEqual([may, june]);

    expect(sorted(["Fiat 500", "BMW 1", "fiat 10"], "asc")).toEqual(["BMW 1", "fiat 10", "Fiat 500"]);
  });

  it("puts empty values last in both directions", () => {
    const mileage = [41500, null, 6200, undefined, 22100, ""];

    expect(sorted(mileage, "asc").slice(0, 3)).toEqual([6200, 22100, 41500]);
    expect(sorted(mileage, "desc").slice(0, 3)).toEqual([41500, 22100, 6200]);
  });
});
