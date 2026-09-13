"use client";

import { createElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The summary tile that appears about fifteen times across the app. The
 * clickable variant is a real button with a pressed state, which the
 * hand-rolled quick-filter tiles on the reservations page approximated
 * with a hover shadow and no indication of which one was active.
 */
type StatTileProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  onClick?: () => void;
  /** Only meaningful with onClick — renders the tile as the current filter. */
  active?: boolean;
  className?: string;
};

export function StatTile({
  label,
  value,
  hint,
  icon,
  onClick,
  active = false,
  className = "",
}: StatTileProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-sm ${active ? "text-gray-300" : "text-ink-muted"}`}
        >
          {label}
        </p>

        {icon &&
          createElement(icon, {
            className: `h-4 w-4 shrink-0 ${
              active ? "text-gray-400" : "text-ink-muted"
            }`,
            "aria-hidden": true,
          })}
      </div>

      <p
        className={`mt-2 text-3xl font-bold tracking-tight ${
          active ? "text-white" : "text-ink"
        }`}
      >
        {value}
      </p>

      {hint && (
        <p
          className={`mt-1 text-xs ${
            active ? "text-gray-400" : "text-ink-muted"
          }`}
        >
          {hint}
        </p>
      )}
    </>
  );

  const shell = "rounded-xl p-5 shadow-sm transition";

  if (!onClick) {
    return (
      <div className={`${shell} bg-surface ${className}`}>{body}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${shell} w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 ${
        active
          ? "bg-gray-900"
          : "bg-surface hover:shadow-md hover:ring-1 hover:ring-border-strong"
      } ${className}`}
    >
      {body}
    </button>
  );
}

export function StatTileGrid({
  children,
  columns = 4,
  className = "",
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  // Explicit literals rather than a template string, so Tailwind's JIT
  // scanner can see every class that might be emitted.
  const columnClass = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-5",
  }[columns];

  return (
    <div className={`grid gap-4 ${columnClass} ${className}`}>{children}</div>
  );
}
