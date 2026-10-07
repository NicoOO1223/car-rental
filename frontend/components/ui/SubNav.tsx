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

/**
 * Section switcher: pill tabs that wrap on small screens, or a vertical
 * list beside the content from `lg` up. Items either switch in-page state
 * (`onSelect`) or link to routes (`href`).
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

  const itemClass = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
      vertical ? "lg:w-full lg:rounded-lg lg:px-3 lg:py-2 lg:text-left" : ""
    } ${
      active
        ? "bg-accent text-on-accent"
        : "bg-surface-sunken text-ink-secondary hover:text-ink"
    }`;

  return (
    <nav
      aria-label={label}
      role={onSelect ? "tablist" : undefined}
      className={`flex flex-wrap gap-2 ${vertical ? "lg:flex-col" : ""} ${className}`}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        const content = (
          <>
            {item.label}
            {item.count !== undefined && (
              <span className="ml-2 opacity-70">{item.count}</span>
            )}
          </>
        );

        if (item.href) {
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`${itemClass(active)} ${vertical ? "lg:block" : ""}`}
            >
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
            className={itemClass(active)}
          >
            {content}
          </button>
        );
      })}
    </nav>
  );
}
