// Single source of truth for status colors across the app.
// Previously every page invented its own color mapping for the same
// statuses — this file replaces all of those local helpers.
//
// Colour is used sparingly, and a status is never told apart by colour
// alone: every pill carries its label. Each status maps to one "weight":
//
//   neutral  nothing to do (confirmed, available)
//   active   happening now; the one weight that uses the brand colour
//   muted    over or called off (completed, cancelled), de-emphasized
//   warning  waiting on staff
//   danger   something is wrong
//
// Warning and danger are fixed colours (see app/globals.css); they do not
// follow the brand colour, so a business's accent can never look like one.

import {
  CheckCheck,
  CircleCheck,
  CircleDot,
  Clock,
  Hourglass,
  KeyRound,
  PlayCircle,
  Sparkles,
  TimerOff,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type ReservationStatusVariant = "subtle" | "solid" | "dot";

type StatusWeight = "neutral" | "active" | "muted" | "warning" | "danger";

const WEIGHT_BADGE: Record<StatusWeight, string> = {
  neutral: "bg-surface-sunken text-ink",
  active: "bg-accent text-on-accent",
  // Finished or called off: an outline, so it recedes next to the others.
  muted: "bg-surface text-ink-muted ring-1 ring-inset ring-border-strong",
  // Waiting on staff.
  warning: "bg-warning-soft text-warning",
  // Something is wrong.
  danger: "bg-danger-soft text-danger",
};

const WEIGHT_SOLID: Record<StatusWeight, string> = {
  neutral: "bg-ink-muted text-surface",
  active: "bg-accent text-on-accent",
  muted: "bg-border-subtle text-ink-muted",
  warning: "bg-warning-strong text-surface",
  danger: "bg-danger text-surface",
};

const WEIGHT_DOT: Record<StatusWeight, string> = {
  neutral: "bg-ink-muted",
  active: "bg-accent",
  muted: "bg-border-strong",
  warning: "bg-warning-strong",
  danger: "bg-danger",
};

const CAR_STATUS_WEIGHT: Record<string, StatusWeight> = {
  AVAILABLE: "neutral",
  RESERVED: "neutral",
  RENTED: "active",
  MAINTENANCE: "neutral",
  CLEANING: "neutral",
};

export const CAR_STATUS_ICONS: Record<string, LucideIcon> = {
  AVAILABLE: CircleCheck,
  RESERVED: Clock,
  RENTED: KeyRound,
  MAINTENANCE: Wrench,
  CLEANING: Sparkles,
};

const DEFAULT_CAR_STATUS_STYLE = "bg-surface-sunken text-ink-secondary";

export function getCarStatusStyle(status: string): string {
  const weight = CAR_STATUS_WEIGHT[status];
  return weight ? WEIGHT_BADGE[weight] : DEFAULT_CAR_STATUS_STYLE;
}

export function getCarStatusIcon(status: string): LucideIcon | undefined {
  return CAR_STATUS_ICONS[status];
}

// Grayscale steps for the fleet-status pie chart — the one place this app
// still leans on lightness for identity, since a pie slice has no room for
// an inline icon+label (the legend beside it carries that, plus each slice
// gets a white 2px stroke so neighbors stay separable even when their
// fills are close). Ordered light-to-dark by "how far this car is from
// being rentable right now": available is lightest, maintenance darkest.
export const CAR_STATUS_HEX: Record<string, string> = {
  AVAILABLE: "#e5e7eb",
  RESERVED: "#9ca3af",
  RENTED: "#6b7280",
  CLEANING: "#374151",
  MAINTENANCE: "#000000",
};

const DEFAULT_CAR_STATUS_HEX = "#9CA3AF";

export function getCarStatusHex(status: string): string {
  return CAR_STATUS_HEX[status] ?? DEFAULT_CAR_STATUS_HEX;
}

const RESERVATION_STATUS_WEIGHT: Record<string, StatusWeight> = {
  // A request nobody has answered yet is the one status waiting on staff.
  PENDING: "warning",
  AWAITING_PAYMENT: "neutral",
  CONFIRMED: "neutral",
  ACTIVE: "active",
  COMPLETED: "neutral",
  CANCELLED: "muted",
  EXPIRED: "muted",
};

export const RESERVATION_STATUS_ICONS: Record<string, LucideIcon> = {
  PENDING: Clock,
  AWAITING_PAYMENT: Hourglass,
  CONFIRMED: CircleCheck,
  ACTIVE: PlayCircle,
  COMPLETED: CheckCheck,
  CANCELLED: XCircle,
  EXPIRED: TimerOff,
};

const DEFAULT_RESERVATION_STATUS_STYLE: Record<ReservationStatusVariant, string> = {
  subtle: "bg-surface-sunken text-ink-secondary",
  solid: "bg-ink-muted text-surface",
  dot: "bg-ink-muted",
};

export function getReservationStatusStyle(
  status: string,
  variant: ReservationStatusVariant = "subtle",
): string {
  const weight = RESERVATION_STATUS_WEIGHT[status];

  if (!weight) {
    return DEFAULT_RESERVATION_STATUS_STYLE[variant];
  }

  if (variant === "solid") return WEIGHT_SOLID[weight];
  if (variant === "dot") return WEIGHT_DOT[weight];
  return WEIGHT_BADGE[weight];
}

export function getReservationStatusIcon(status: string): LucideIcon | undefined {
  return RESERVATION_STATUS_ICONS[status];
}

// --- Maintenance tasks ---------------------------------------------------
//
// A task has two independent dimensions, and the maintenance page used to
// conflate them: it rendered task_type through CarStatusBadge (which
// happened to work only because MAINTENANCE and CLEANING are also car
// statuses) and printed task status as bare text with no badge at all.

const TASK_TYPE_WEIGHT: Record<string, StatusWeight> = {
  MAINTENANCE: "neutral",
  CLEANING: "neutral",
};

export const TASK_TYPE_ICONS: Record<string, LucideIcon> = {
  MAINTENANCE: Wrench,
  CLEANING: Sparkles,
};

const TASK_STATUS_WEIGHT: Record<string, StatusWeight> = {
  OPEN: "active",
  DONE: "neutral",
  CANCELLED: "muted",
};

export const TASK_STATUS_ICONS: Record<string, LucideIcon> = {
  OPEN: CircleDot,
  DONE: CheckCheck,
  CANCELLED: XCircle,
};

export function getTaskTypeStyle(taskType: string): string {
  const weight = TASK_TYPE_WEIGHT[taskType];
  return weight ? WEIGHT_BADGE[weight] : DEFAULT_CAR_STATUS_STYLE;
}

export function getTaskTypeIcon(taskType: string): LucideIcon | undefined {
  return TASK_TYPE_ICONS[taskType];
}

export function getTaskStatusStyle(status: string): string {
  const weight = TASK_STATUS_WEIGHT[status];
  return weight ? WEIGHT_BADGE[weight] : DEFAULT_CAR_STATUS_STYLE;
}

export function getTaskStatusIcon(status: string): LucideIcon | undefined {
  return TASK_STATUS_ICONS[status];
}
