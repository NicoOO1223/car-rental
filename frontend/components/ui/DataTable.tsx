"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { t } from "@/lib/i18n";

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

export type SortDirection = "asc" | "desc";

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

export type SortValue = string | number | Date | null | undefined;

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

  empty?: DataTableEmpty;
  className?: string;
};

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
      <div className="font-medium text-ink">{primary}</div>
      {secondary !== undefined && secondary !== null && (
        <div className="mt-1 text-sm text-ink-muted">{secondary}</div>
      )}
    </>
  );
}

function defaultCompare(a: SortValue, b: SortValue): number {
  // Nulls sort last regardless of direction, so an empty cell never
  // occupies the top of the table.
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";

  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a).localeCompare(String(b), undefined, {
    sensitivity: "base",
    numeric: true,
  });
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
  empty,
  className = "",
}: DataTableProps<Row>) {
  const [internalSort, setInternalSort] = useState<SortState | null>(
    defaultSort ?? null,
  );

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
    if (!activeSort) return rows;

    const column = columns.find((item) => item.id === activeSort.columnId);
    if (!column) return rows;

    const compare =
      column.comparator ??
      ((a: Row, b: Row) =>
        defaultCompare(
          column.sortAccessor?.(a) ?? null,
          column.sortAccessor?.(b) ?? null,
        ));

    // Sort a copy. Array.prototype.sort is stable, so ties keep the
    // incoming order.
    const copy = [...rows];
    copy.sort(compare);

    return activeSort.direction === "desc" ? copy.reverse() : copy;
  }, [rows, columns, activeSort]);

  const showCards = layout !== "table";
  const showTable = layout !== "cards";

  const tableColumns = columns.filter((column) => !column.mobileOnly);

  if (!loading && sortedRows.length === 0 && empty) {
    return <EmptyState {...empty} className={className} />;
  }

  const visibleActions = (row: Row) =>
    (rowActions ?? []).filter((action) => !action.hidden?.(row));

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border-subtle bg-surface ${className}`}
    >
      {showCards && (
        <div
          className={`divide-y divide-border-subtle ${
            layout === "responsive" ? "lg:hidden" : ""
          }`}
        >
          {loading
            ? Array.from({ length: loadingRowCount }).map((_, index) => (
                <div key={index} className="p-4">
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
          <table className="w-full text-left">
            <thead className="border-b border-border-subtle bg-surface-sunken">
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
                      className={`px-6 py-3.5 text-sm font-semibold text-ink ${
                        column.align === "right" ? "text-right" : ""
                      } ${column.width ?? ""} ${column.headerClassName ?? ""}`}
                    >
                      {column.sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column)}
                          className={`inline-flex items-center gap-1.5 rounded font-semibold transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
                            isSorted ? "text-ink" : "text-ink-secondary"
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

                {rowActions && rowActions.length > 0 && (
                  <th scope="col" className="px-6 py-3.5 text-right text-sm font-semibold text-ink">
                    {rowActionsHeader ?? <span className="sr-only">{t("ui.actions")}</span>}
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {loading
                ? Array.from({ length: loadingRowCount }).map((_, index) => (
                    <tr key={index} className="border-b border-border-subtle last:border-b-0">
                      {tableColumns.map((column) => (
                        <td key={column.id} className="px-6 py-5">
                          <Skeleton className="h-4 w-24" />
                        </td>
                      ))}
                      {rowActions && rowActions.length > 0 && (
                        <td className="px-6 py-5">
                          <Skeleton className="ml-auto h-4 w-16" />
                        </td>
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
                        className={`border-b border-border-subtle last:border-b-0 ${
                          onRowClick
                            ? "cursor-pointer hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ink"
                            : ""
                        }`}
                      >
                        {tableColumns.map((column) => (
                          <td
                            key={column.id}
                            className={`px-6 py-5 align-top ${
                              column.align === "right" ? "text-right" : ""
                            } ${column.cellClassName ?? ""}`}
                          >
                            {column.cell(row)}
                          </td>
                        ))}

                        {rowActions && rowActions.length > 0 && (
                          <td className="px-6 py-5 text-right align-top">
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
                                  className="px-3 py-1.5 text-xs"
                                >
                                  {action.label}
                                </Button>
                              ))}
                            </div>
                          </td>
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
            <div key={column.id} className="truncate font-medium text-ink">
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
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          {meta.map((column) => (
            <div key={column.id}>
              <p className="text-ink-muted">
                {column.mobileLabel ??
                  (typeof column.header === "string" ? column.header : "")}
              </p>
              <div className="mt-0.5 font-medium text-ink">{render(column)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (onRowClick && actions.length === 0) {
    return (
      <button
        type="button"
        onClick={() => onRowClick(row)}
        className="block w-full p-4 text-left transition hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ink"
      >
        {body}
      </button>
    );
  }

  return (
    <div className="p-4">
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
              className="px-3 py-1.5 text-xs"
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
