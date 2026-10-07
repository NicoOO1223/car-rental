// Ordering two cell values, for tables that sort their own rows.

export type SortDirection = "asc" | "desc";

export type SortValue = string | number | Date | null | undefined;

const isEmpty = (value: SortValue) => value === null || value === undefined || value === "";

/**
 * Compares two values for sorting in the given direction. An empty value
 * (null, undefined, "") always comes last, whichever way the column runs: a
 * car with no mileage recorded is not the one with the most.
 */
export function compareValues(a: SortValue, b: SortValue, direction: SortDirection = "asc"): number {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);

  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let order: number;

  if (a instanceof Date && b instanceof Date) {
    order = a.getTime() - b.getTime();
  } else if (typeof a === "number" && typeof b === "number") {
    order = a - b;
  } else {
    order = String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
  }

  return direction === "desc" ? -order : order;
}
