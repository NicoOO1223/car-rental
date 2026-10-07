"use client";

import Link from "next/link";

export type SubNavItem = {
  id: string;
  label: string;
  /** A small figure shown after the label, e.g. how many rows the tab holds. */
  count?: number;
  /** Navigates to a route instead of calling onSelect. */
  href?: string;
};

/** Up to this many options sit side by side as one segmented switch. */
const SEGMENTED_MAX = 4;

/**
 * Section switcher. Items either switch in-page state (`onSelect`) or link to
 * routes (`href`). It picks its own shape:
 *
 * - a few options (two views of the same thing): one segmented switch;
 * - many options: pills that wrap onto more lines;
 * - `orientation="vertical"`: a list beside the content from `lg` up, pills below that.
 */
export function SubNav({
  items,
  activeId,
  onSelect,
  orientation = "horizontal",
  label,
  className = "",
}: {
  items: SubNavItem[];
  activeId: string;
  onSelect?: (id: string) => void;
  orientation?: "horizontal" | "vertical";
  label?: string;
  className?: string;
}) {
  const vertical = orientation === "vertical";
  const segmented = !vertical && items.length <= SEGMENTED_MAX;

  const focus = "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink";

  const itemClass = (active: boolean) => {
    if (segmented) {
      return `inline-flex items-center justify-center rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${focus} ${
        active ? "bg-surface text-ink shadow-sm" : "text-ink-secondary hover:text-ink"
      }`;
    }

    return `rounded-full px-3.5 py-1.5 text-sm font-medium transition ${focus} ${
      vertical ? "lg:block lg:w-full lg:rounded-lg lg:px-3 lg:py-2 lg:text-left" : ""
    } ${
      active
        ? "bg-accent-soft font-semibold text-accent-ink"
        : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
    }`;
  };

  const countClass = (active: boolean) =>
    `ml-2 rounded-full px-1.5 text-xs tabular-nums ${
      active ? "bg-accent-soft text-accent-ink" : "bg-border-subtle text-ink-secondary"
    }`;

  return (
    <nav
      aria-label={label}
      role={onSelect ? "tablist" : undefined}
      className={
        segmented
          ? `inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-sunken p-1 ${className}`
          : `flex flex-wrap gap-1.5 ${vertical ? "lg:flex-col lg:gap-0.5" : ""} ${className}`
      }
    >
      {items.map((item) => {
        const active = item.id === activeId;
        const content = (
          <>
            {item.label}
            {item.count !== undefined && <span className={countClass(active)}>{item.count}</span>}
          </>
        );

        if (item.href) {
          return (
            <Link key={item.id} href={item.href} aria-current={active ? "page" : undefined} className={itemClass(active)}>
              {content}
            </Link>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect?.(item.id)}
            className={`whitespace-nowrap ${itemClass(active)}`}
          >
            {content}
          </button>
        );
      })}
    </nav>
  );
}
