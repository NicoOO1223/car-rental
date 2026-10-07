// Column-header sorting for lists the server pages.
//
// A table that holds every row can sort them itself. A list loaded one page
// at a time cannot: sorting the 25 rows on screen would not find the row that
// belongs first. So for those lists a click on a header asks the server for a
// different order, through the same `sort` parameter the URL already carries.
//
// The server names an order "<key>_<direction>" ("pickup_asc"). Each page
// gives a map from its column ids to those keys.

import type { SortState } from "@/components/ui/DataTable";

/** Column id -> the server's name for sorting by it. */
export type SortKeys = Record<string, string>;

/** The column and direction a `sort` parameter means, or null if it is not one of this table's. */
export function parseSort(param: string, keys: SortKeys): SortState | null {
  const cut = param.lastIndexOf("_");
  const key = param.slice(0, cut);
  const direction = param.slice(cut + 1);

  if (cut < 1 || (direction !== "asc" && direction !== "desc")) return null;

  const columnId = Object.keys(keys).find((id) => keys[id] === key);

  return columnId ? { columnId, direction } : null;
}

/**
 * The `sort` parameter for a header's new state. Clearing the sort (the third
 * click on a header) goes back to the list's own default order.
 */
export function sortParam(next: SortState | null, keys: SortKeys, fallback: string): string {
  const key = next ? keys[next.columnId] : undefined;

  return next && key ? `${key}_${next.direction}` : fallback;
}

/** Every order a table offers, for the "Sort by" list phones use instead of headers. */
export function sortOptions(
  columns: { id: string; header: unknown }[],
  keys: SortKeys,
): { value: string; label: string }[] {
  return columns
    .filter((column) => keys[column.id] && typeof column.header === "string")
    .flatMap((column) => [
      { value: `${keys[column.id]}_asc`, label: `${column.header} ↑` },
      { value: `${keys[column.id]}_desc`, label: `${column.header} ↓` },
    ]);
}
