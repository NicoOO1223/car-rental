// Single source of truth for status colors across the app.
// Previously every page invented its own color mapping for the same
// statuses — this file replaces all of those local helpers.
//
// The app is deliberately monochrome: status identity comes from an icon
// + label, never from hue. Every status maps to one of three grayscale
// "weights" — neutral (quiescent/informational), active (happening right
// now — operationally the one state worth visually emphasizing), and
// muted (terminal/negative — de-emphasized on purpose, e.g. cancelled).

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

type StatusWeight = "neutral" | "active" | "muted";

const WEIGHT_BADGE: Record<StatusWeight, string> = {
  neutral: "bg-gray-100 text-gray-700",
  active: "bg-gray-900 text-white",
  // Raised from text-gray-400 (about 2.8:1 on white, below AA). Muted
  // still reads as de-emphasized against the darker neutral weight.
  muted: "bg-white text-gray-500 border border-gray-300",
};

const WEIGHT_SOLID: Record<StatusWeight, string> = {
  neutral: "bg-gray-500 text-white",
  active: "bg-gray-900 text-white",
  muted: "bg-gray-200 text-gray-500",
};

const WEIGHT_DOT: Record<StatusWeight, string> = {
  neutral: "bg-gray-400",
  active: "bg-gray-900",
  muted: "bg-gray-300",
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

const DEFAULT_CAR_STATUS_STYLE = "bg-gray-100 text-gray-700";

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
  PENDING: "neutral",
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
  subtle: "bg-gray-100 text-gray-700",
  solid: "bg-gray-500 text-white",
  dot: "bg-gray-400",
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
