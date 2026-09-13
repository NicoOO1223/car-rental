import { createElement, type ReactNode } from "react";

import {
  getCarStatusIcon,
  getCarStatusStyle,
  getReservationStatusIcon,
  getReservationStatusStyle,
  getTaskStatusIcon,
  getTaskStatusStyle,
  getTaskTypeIcon,
  getTaskTypeStyle,
  type ReservationStatusVariant,
} from "@/lib/status";

/** Statuses are stored as uppercase enums; render them as words. */
function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

export function Badge({
  children,
  colorClass,
  className = "",
}: {
  children: ReactNode;
  colorClass: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${colorClass} ${className}`}
    >
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
  const icon = getCarStatusIcon(status);

  return (
    <Badge colorClass={getCarStatusStyle(status)} className={className}>
      {icon && createElement(icon, { className: "h-3 w-3 shrink-0" })}
      {status}
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
  const icon = getReservationStatusIcon(status);

  return (
    <Badge
      colorClass={getReservationStatusStyle(status, variant)}
      className={className}
    >
      {icon && createElement(icon, { className: "h-3 w-3 shrink-0" })}
      {status}
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

  return (
    <Badge colorClass={getTaskTypeStyle(taskType)} className={className}>
      {icon && createElement(icon, { className: "h-3 w-3 shrink-0" })}
      {statusLabel(taskType)}
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
  const icon = getTaskStatusIcon(status);

  return (
    <Badge colorClass={getTaskStatusStyle(status)} className={className}>
      {icon && createElement(icon, { className: "h-3 w-3 shrink-0" })}
      {statusLabel(status)}
    </Badge>
  );
}
