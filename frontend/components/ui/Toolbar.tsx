"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

import { t } from "@/lib/i18n";

/**
 * The filter bar above a list. On a phone the filters sit behind a button, so
 * the list itself is on the first screen; from `sm` up they are always shown.
 */
export function Toolbar({
  children,
  footer,
  className = "",
}: {
  children: ReactNode;
  /** Result counts, active-filter summary, a clear-filters button. */
  footer?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className={`mb-4 rounded-2xl border border-border-subtle bg-surface p-4 sm:p-5 ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-sm font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink sm:hidden"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          {t("ui.filters")}
        </span>
        <ChevronDown className={`h-4 w-4 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      <div id={id} className={`${open ? "mt-4 grid" : "hidden"} gap-4 sm:mt-0 sm:grid sm:grid-cols-2 lg:grid-cols-4`}>
        {children}
      </div>

      {footer && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3 text-sm text-ink-muted sm:mt-4 sm:pt-4">
          {footer}
        </div>
      )}
    </div>
  );
}
