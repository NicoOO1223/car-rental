import type { ReactNode } from "react";

import {
  getCarStatusStyle,
  getReservationStatusStyle,
  getTaskStatusStyle,
  getTaskTypeIcon,
  getTaskTypeStyle,
  type ReservationStatusVariant,
} from "@/lib/status";
import { enumLabel } from "@/lib/i18n";
import { createElement } from "react";

/**
 * A pill. With `dot` it is a status: a small dot in the pill's own text
 * colour, then the label in sentence case. The label always says what the
 * status is, so the colour is never the only cue.
 */
export function Badge({
  children,
  colorClass,
  dot = false,
  className = "",
}: {
  children: ReactNode;
  colorClass: string;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${colorClass} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function CarStatusBadge({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  return (
    <Badge dot colorClass={getCarStatusStyle(status)} className={className}>
      {enumLabel("carStatus", status)}
    </Badge>
  );
}

export function ReservationStatusBadge({
  status,
  variant = "subtle",
  className = "",
}: {
  status: string;
  variant?: ReservationStatusVariant;
  className?: string;
}) {
  return (
    <Badge dot colorClass={getReservationStatusStyle(status, variant)} className={className}>
      {enumLabel("reservationStatus", status)}
    </Badge>
  );
}

export function TaskTypeBadge({
  taskType,
  className = "",
}: {
  taskType: string;
  className?: string;
}) {
  const icon = getTaskTypeIcon(taskType);

  // A kind of work, not a state: it keeps its icon and has no dot.
  return (
    <Badge colorClass={getTaskTypeStyle(taskType)} className={className}>
      {icon && createElement(icon, { className: "h-3 w-3 shrink-0", "aria-hidden": true })}
      {enumLabel("taskType", taskType)}
    </Badge>
  );
}

export function TaskStatusBadge({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  return (
    <Badge dot colorClass={getTaskStatusStyle(status)} className={className}>
      {enumLabel("taskStatus", status)}
    </Badge>
  );
}
