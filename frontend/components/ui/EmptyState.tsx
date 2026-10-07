import { createElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The "nothing to show" panel. Five pages hand-rolled a version of this,
 * and the fleet page invented a sixth with different padding and an icon.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center ${className}`}
    >
      {icon && (
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
          {createElement(icon, { className: "h-5 w-5", "aria-hidden": true })}
        </div>
      )}

      <p className="font-medium text-ink">{title}</p>

      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
          {description}
        </p>
      )}

      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
