import type { ReactNode } from "react";

/**
 * The filter bar above a list. Three pages hand-rolled this same panel
 * with the same grid and label styling.
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
  return (
    <div
      className={`mb-6 rounded-xl bg-surface p-5 shadow-sm ${className}`}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>

      {footer && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4 text-sm text-ink-muted">
          {footer}
        </div>
      )}
    </div>
  );
}
