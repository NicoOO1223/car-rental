"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { t } from "@/lib/i18n";
import { compareValues, type SortDirection, type SortValue } from "@/lib/sortValues";

/**
 * One table, driven by column definitions, rendering both the desktop
 * table and the mobile card list.
 *
 * Before this, four list pages hand-rolled byte-identical table shells,
 * and three of them wrote out every column *twice* in source: once as a
 * `divide-y lg:hidden` card list and once as a `hidden lg:block` table.
 * Editing a column meant editing it in two places, and they had already
 * drifted. Here a column declares where it lands in the card via its
 * `mobile` role, and both layouts come from the same config.
 *
 * DataTable never filters. Pages filter their own rows and pass the
 * result in, because the filter controls and their URL syncing belong to
 * the page. Sorting does live here, because it is a property of the table.
 */

export type { SortDirection, SortValue } from "@/lib/sortValues";

export type SortState = {
  columnId: string;
  direction: SortDirection;
};

/**
 * Where a column lands in the mobile card:
 *
 * - primary   bold line at the top left
 * - secondary supporting line beneath it
 * - trailing  top right, typically a status badge
 * - meta      labelled cell in the grid below (the default)
 * - hidden    desktop only
 */
export type MobileRole =
  | "primary"
  | "secondary"
  | "trailing"
  | "meta"
  | "hidden";


export type Column<Row> = {
  /** Stable id, also the token used in the sort URL parameter. */
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;

  mobile?: MobileRole;
  /** Label above the value in the card's meta grid. Defaults to `header`. */
  mobileLabel?: string;
  /** Overrides `cell` on mobile, for a denser format. */
  mobileCell?: (row: Row) => ReactNode;
  /**
   * Omit this column from the desktop table. Use it for a value the card
   * needs as its own line but the table already folds into another cell,
   * such as a plate shown under the vehicle name.
   */
  mobileOnly?: boolean;

  /**
   * Lets people hide this column from the table's View menu (needs `tableId`).
   * `defaultHidden` starts it hidden: a detail some people want and most do not.
   */
  hideable?: boolean;
  defaultHidden?: boolean;

  sortable?: boolean;
  /** Value the default comparator sorts on. Ignored when `comparator` is set. */
  sortAccessor?: (row: Row) => SortValue;
  /** Full control. Always write it ascending; the table inverts for desc. */
  comparator?: (a: Row, b: Row) => number;
  defaultSortDirection?: SortDirection;

  align?: "left" | "right";
  /** Tailwind width class for the header cell. Must be a literal. */
  width?: string;
  headerClassName?: string;
  cellClassName?: string;
};

export type RowAction<Row> = {
  label: string;
  onClick: (row: Row) => void | Promise<void>;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  hidden?: (row: Row) => boolean;
  disabled?: (row: Row) => boolean;
};

export type DataTableEmpty = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
};

export type DataTableProps<Row> = {
  /** Already filtered by the page. */
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;

  /**
   * responsive  cards below lg, table at lg and up (the default)
   * cards       cards at every width
   * table       table at every width
   */
  layout?: "responsive" | "cards" | "table";

  loading?: boolean;
  loadingRowCount?: number;

  onRowClick?: (row: Row) => void;

  rowActions?: RowAction<Row>[];
  rowActionsHeader?: ReactNode;

  /** Controlled sorting. Omit all three to render rows in the given order. */
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  defaultSort?: SortState;
  /**
   * The rows arrive already in the order `sort` names (a list the server
   * pages, see lib/serverSort.ts). Headers still show and change the sort,
   * but the table does not reorder the page of rows it was given.
   */
  serverSorted?: boolean;

  empty?: DataTableEmpty;
  className?: string;

  /**
   * A stable name for this table. With it the table gets a View menu (row
   * height, and which hideable columns show) and remembers the choice in
   * this browser.
   */
  tableId?: string;
};

type Density = "comfortable" | "compact";

// Each row is its own card: the cells share a top and bottom border, and the
// first and last close it with a rounded end. Under the pointer the whole
// row takes the brand colour's tint.
const ROW_CELL =
  "border-y border-border-subtle bg-surface transition-colors first:rounded-l-xl first:border-l last:rounded-r-xl last:border-r group-hover:border-accent-line group-hover:bg-accent-soft";

const DENSITY_KEY = "table-density";
const PREFERENCE_EVENT = "table-preference";

function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A choice kept in this browser. localStorage does not exist on the server
 * and can be blocked in the browser, so the value is null until it is known
 * and the caller falls back to its default.
 */
function useStoredPreference(key: string | null): [string | null, (value: string) => void] {
  const value = useSyncExternalStore(
    (notify) => {
      window.addEventListener("storage", notify);
      window.addEventListener(PREFERENCE_EVENT, notify);

      return () => {
        window.removeEventListener("storage", notify);
        window.removeEventListener(PREFERENCE_EVENT, notify);
      };
    },
    () => (key ? readPreference(key) : null),
    () => null,
  );

  function set(next: string) {
    if (!key) return;

    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Not remembered, but still applied for this visit by the event below.
    }

    // A write does not fire a storage event in the tab that made it.
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }

  return [value, set];
}

/** The very common bold-line-over-gray-line cell. */
export function TwoLine({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <>
      <div className="font-semibold text-ink">{primary}</div>
      {secondary !== undefined && secondary !== null && (
        <div className="mt-0.5 text-xs text-ink-muted">{secondary}</div>
      )}
    </>
  );
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  layout = "responsive",
  loading = false,
  loadingRowCount = 6,
  onRowClick,
  rowActions,
  rowActionsHeader,
  sort,
  onSortChange,
  defaultSort,
  serverSorted = false,
  empty,
  className = "",
  tableId,
}: DataTableProps<Row>) {
  const [internalSort, setInternalSort] = useState<SortState | null>(
    defaultSort ?? null,
  );

  const [storedDensity, setStoredDensity] = useStoredPreference(tableId ? DENSITY_KEY : null);
  const density: Density = storedDensity === "compact" ? "compact" : "comfortable";

  // Which hideable columns are hidden: the remembered list, else each column's own default.
  const [storedHidden, setStoredHidden] = useStoredPreference(tableId ? `table:${tableId}:hidden` : null);
  const hiddenIds = useMemo(() => {
    const hideable = columns.filter((column) => column.hideable);

    if (storedHidden === null) {
      return new Set(hideable.filter((column) => column.defaultHidden).map((column) => column.id));
    }

    const remembered = new Set(storedHidden.split(",").filter(Boolean));

    return new Set(hideable.filter((column) => remembered.has(column.id)).map((column) => column.id));
  }, [columns, storedHidden]);

  function toggleColumn(id: string) {
    const next = new Set(hiddenIds);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    setStoredHidden([...next].join(","));
  }

  const isControlled = sort !== undefined;
  const activeSort = isControlled ? sort : internalSort;

  function applySort(next: SortState | null) {
    if (!isControlled) {
      setInternalSort(next);
    }
    onSortChange?.(next);
  }

  function toggleSort(column: Column<Row>) {
    const first = column.defaultSortDirection ?? "asc";
    const second = first === "asc" ? "desc" : "asc";

    if (activeSort?.columnId !== column.id) {
      applySort({ columnId: column.id, direction: first });
      return;
    }

    // asc -> desc -> unsorted. Returning to unsorted restores the order
    // the page passed rows in, which is the backend's ORDER BY.
    if (activeSort.direction === first) {
      applySort({ columnId: column.id, direction: second });
      return;
    }

    applySort(null);
  }

  const sortedRows = useMemo(() => {
    if (!activeSort || serverSorted) return rows;

    const column = columns.find((item) => item.id === activeSort.columnId);
    if (!column) return rows;

    // Sort a copy. Array.prototype.sort is stable, so ties keep the
    // incoming order.
    const copy = [...rows];

    // A column's own comparator is written ascending, so it is reversed.
    if (column.comparator) {
      copy.sort(column.comparator);

      return activeSort.direction === "desc" ? copy.reverse() : copy;
    }

    // Otherwise the direction goes into the comparison, which keeps empty
    // cells at the bottom both ways (reversing would lift them to the top).
    const value = (row: Row) => column.sortAccessor?.(row) ?? null;

    return copy.sort((a, b) => compareValues(value(a), value(b), activeSort.direction));
  }, [rows, columns, activeSort, serverSorted]);

  const showCards = layout !== "table";
  const showTable = layout !== "cards";

  const tableColumns = columns.filter((column) => !column.mobileOnly && !hiddenIds.has(column.id));
  const cellPadding = density === "compact" ? "px-4 py-2" : "px-4 py-3.5";

  const viewMenu = tableId ? (
    <ViewMenu
      density={density}
      onDensityChange={setStoredDensity}
      columns={columns.filter((column) => column.hideable && !column.mobileOnly)}
      hiddenIds={hiddenIds}
      onToggleColumn={toggleColumn}
    />
  ) : null;

  if (!loading && sortedRows.length === 0 && empty) {
    return <EmptyState {...empty} className={className} />;
  }

  const visibleActions = (row: Row) =>
    (rowActions ?? []).filter((action) => !action.hidden?.(row));

  return (
    <div className={className}>
      {showCards && (
        <div className={`space-y-2 ${layout === "responsive" ? "lg:hidden" : ""}`}>
          {loading
            ? Array.from({ length: loadingRowCount }).map((_, index) => (
                <div key={index} className="rounded-xl border border-border-subtle bg-surface p-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-2 h-3 w-28" />
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))
            : sortedRows.map((row) => (
                <MobileCard
                  key={rowKey(row)}
                  row={row}
                  columns={columns}
                  onRowClick={onRowClick}
                  actions={visibleActions(row)}
                />
              ))}
        </div>
      )}

      {showTable && (
        <div
          className={`overflow-x-auto ${
            layout === "responsive" ? "hidden lg:block" : ""
          }`}
        >
          <table className="w-full border-separate border-spacing-x-0 border-spacing-y-2 text-left text-sm">
            <thead>
              <tr>
                {tableColumns.map((column) => {
                  const isSorted = activeSort?.columnId === column.id;

                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={
                        !column.sortable
                          ? undefined
                          : isSorted
                            ? activeSort.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                      }
                      className={`px-4 pb-0.5 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-muted first:pl-5 last:pr-5 ${
                        column.align === "right" ? "text-right" : ""
                      } ${column.width ?? ""} ${column.headerClassName ?? ""}`}
                    >
                      {column.sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column)}
                          className={`inline-flex items-center gap-1 rounded font-semibold uppercase tracking-wide transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
                            isSorted ? "text-ink" : "text-ink-muted"
                          }`}
                        >
                          {column.header}

                          {!isSorted && (
                            <ChevronsUpDown
                              className="h-3.5 w-3.5 text-border-strong"
                              aria-hidden="true"
                            />
                          )}
                          {isSorted && activeSort.direction === "asc" && (
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {isSorted && activeSort.direction === "desc" && (
                            <ChevronDown
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}

                {rowActions && rowActions.length > 0 ? (
                  <th scope="col" className="px-4 pb-0.5 pt-1 pr-3 text-right text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    <span className="inline-flex items-center justify-end gap-2">
                      {rowActionsHeader ?? <span className="sr-only">{t("ui.actions")}</span>}
                      {viewMenu}
                    </span>
                  </th>
                ) : (
                  viewMenu && (
                    <th scope="col" className="w-12 pb-0.5 pt-1 pr-3 text-right">
                      {viewMenu}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {loading
                ? Array.from({ length: loadingRowCount }).map((_, index) => (
                    <tr key={index}>
                      {tableColumns.map((column) => (
                        <td key={column.id} className={`${cellPadding} ${ROW_CELL} first:pl-5 last:pr-5`}>
                          <Skeleton className="h-4 w-24" />
                        </td>
                      ))}
                      {rowActions && rowActions.length > 0 ? (
                        <td className={`${cellPadding} ${ROW_CELL} pr-5`}>
                          <Skeleton className="ml-auto h-4 w-16" />
                        </td>
                      ) : (
                        viewMenu && <td className={ROW_CELL} />
                      )}
                    </tr>
                  ))
                : sortedRows.map((row) => {
                    const actions = visibleActions(row);

                    return (
                      <tr
                        key={rowKey(row)}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        onKeyDown={
                          onRowClick
                            ? (event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  onRowClick(row);
                                }
                              }
                            : undefined
                        }
                        tabIndex={onRowClick ? 0 : undefined}
                        role={onRowClick ? "button" : undefined}
                        className={
                          onRowClick
                            ? "group cursor-pointer focus:outline-none focus-visible:[&>td]:border-accent-ink focus-visible:[&>td]:bg-accent-soft"
                            : "group"
                        }
                      >
                        {tableColumns.map((column) => (
                          <td
                            key={column.id}
                            className={`${cellPadding} ${ROW_CELL} align-middle first:pl-5 last:pr-5 ${
                              column.align === "right" ? "text-right" : ""
                            } ${column.cellClassName ?? ""}`}
                          >
                            {column.cell(row)}
                          </td>
                        ))}

                        {rowActions && rowActions.length > 0 ? (
                          <td className={`${cellPadding} ${ROW_CELL} pr-5 text-right align-middle`}>
                            <div className="flex justify-end gap-2">
                              {actions.map((action) => (
                                <Button
                                  key={action.label}
                                  variant={action.variant ?? "secondary"}
                                  disabled={action.disabled?.(row)}
                                  onClick={(event) => {
                                    // Row click and row actions can coexist.
                                    event.stopPropagation();
                                    action.onClick(row);
                                  }}
                                  size="sm"
                                >
                                  {action.label}
                                </Button>
                              ))}
                            </div>
                          </td>
                        ) : (
                          viewMenu && <td className={ROW_CELL} />
                        )}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MobileCard<Row>({
  row,
  columns,
  onRowClick,
  actions,
}: {
  row: Row;
  columns: Column<Row>[];
  onRowClick?: (row: Row) => void;
  actions: RowAction<Row>[];
}) {
  const render = (column: Column<Row>) =>
    (column.mobileCell ?? column.cell)(row);

  const roleOf = (column: Column<Row>) => column.mobile ?? "meta";

  const primary = columns.filter((column) => roleOf(column) === "primary");
  const secondary = columns.filter((column) => roleOf(column) === "secondary");
  const trailing = columns.filter((column) => roleOf(column) === "trailing");
  const meta = columns.filter((column) => roleOf(column) === "meta");

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {primary.map((column) => (
            <div key={column.id} className="truncate text-sm font-semibold text-ink">
              {render(column)}
            </div>
          ))}

          {secondary.map((column) => (
            <div
              key={column.id}
              className="mt-0.5 truncate text-xs text-ink-muted"
            >
              {render(column)}
            </div>
          ))}
        </div>

        {trailing.length > 0 && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {trailing.map((column) => (
              <div key={column.id}>{render(column)}</div>
            ))}
          </div>
        )}
      </div>

      {meta.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {meta.map((column) => {
            const label = column.mobileLabel ?? (typeof column.header === "string" ? column.header : "");

            return (
              <div key={column.id} className={`flex min-w-0 items-baseline gap-1.5 ${label ? "" : "basis-full"}`}>
                {label && <dt className="shrink-0 text-ink-muted">{label}</dt>}
                <dd className="min-w-0 font-medium text-ink">{render(column)}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </>
  );

  if (onRowClick && actions.length === 0) {
    return (
      <button
        type="button"
        onClick={() => onRowClick(row)}
        className="block w-full rounded-xl border border-border-subtle bg-surface p-4 text-left transition hover:border-accent-line hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
      >
        {body}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4 transition hover:border-accent-line hover:bg-accent-soft">
      {onRowClick ? (
        <button
          type="button"
          onClick={() => onRowClick(row)}
          className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
        >
          {body}
        </button>
      ) : (
        body
      )}

      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant ?? "secondary"}
              disabled={action.disabled?.(row)}
              onClick={() => action.onClick(row)}
              size="sm"
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The table's own settings, behind one small button in the header row: how
 * tall the rows are, and which optional columns show.
 */
function ViewMenu<Row>({
  density,
  onDensityChange,
  columns,
  hiddenIds,
  onToggleColumn,
}: {
  density: Density;
  onDensityChange: (density: Density) => void;
  columns: Column<Row>[];
  hiddenIds: Set<string>;
  onToggleColumn: (id: string) => void;
}) {
  // Where the panel goes, measured from the button when it opens. Fixed to the
  // window: the table scrolls sideways in its own box, which would clip it.
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const open = place !== null;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const close = () => setPlace(null);

    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) close();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    // The button moves when the page does; closing is simpler than following it.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const option = (active: boolean) =>
    `flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
      active ? "bg-surface text-ink shadow-sm" : "text-ink-secondary hover:text-ink"
    }`;

  return (
    <div ref={root} className="relative inline-block text-left normal-case tracking-normal">
      <button
        type="button"
        aria-label={t("ui.table.view")}
        title={t("ui.table.view")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();

          if (open) {
            setPlace(null);
            return;
          }

          const box = event.currentTarget.getBoundingClientRect();
          setPlace({ top: box.bottom + 4, right: window.innerWidth - box.right });
        }}
        className="rounded-lg p-1.5 text-ink-muted transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {place && (
        <div
          style={{ top: place.top, right: place.right }}
          className="fixed z-50 w-56 rounded-xl border border-border-subtle bg-surface p-3 text-sm font-normal text-ink shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-xs font-semibold text-ink-muted">{t("ui.table.rowHeight")}</p>
          <div className="mt-1.5 flex gap-1 rounded-lg bg-surface-sunken p-1" role="group" aria-label={t("ui.table.rowHeight")}>
            <button type="button" aria-pressed={density === "comfortable"} onClick={() => onDensityChange("comfortable")} className={option(density === "comfortable")}>
              {t("ui.table.comfortable")}
            </button>
            <button type="button" aria-pressed={density === "compact"} onClick={() => onDensityChange("compact")} className={option(density === "compact")}>
              {t("ui.table.compact")}
            </button>
          </div>

          {columns.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold text-ink-muted">{t("ui.table.columns")}</p>
              <ul className="mt-1">
                {columns.map((column) => {
                  const shown = !hiddenIds.has(column.id);

                  return (
                    <li key={column.id}>
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={shown}
                        onClick={() => onToggleColumn(column.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                      >
                        <span>{column.header}</span>
                        {shown && <Check className="h-4 w-4 text-accent-ink" aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
