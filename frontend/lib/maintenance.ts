import { todayInZone } from "@/lib/format";
import { enumLabel } from "@/lib/i18n";
// The label is a getter so it is worded in the language showing when it is
// read, not the one showing when this module was first loaded.
export const MAINTENANCE_CATEGORIES = (
  ["DAMAGE_REPAIR", "TECHNICAL_INSPECTION", "ROUTINE_SERVICE", "OTHER"] as const
).map((value) => ({
  value,
  get label() {
    return enumLabel("maintenanceCategory", value);
  },
}));

export function maintenanceCategoryLabel(
  category: string | null | undefined,
): string {
  return category ? enumLabel("maintenanceCategory", category) : "";
}

// How many days ahead a date counts as "due soon". Configuration decides;
// this is the value until the server's is known.
let dueSoonDays = 30;

export function setReminderDays(days: number): void {
  dueSoonDays = days;
}

/** How a car's next technical inspection date stands relative to today. */
export function inspectionStatus(
  nextDue: string | null | undefined,
): "overdue" | "soon" | "ok" | null {
  if (!nextDue) return null;

  const [year, month, day] = nextDue.split("-").map(Number);
  const due = new Date(year, month - 1, day);

  // Today at the business, as a plain calendar day.
  const [todayYear, todayMonth, todayDay] = todayInZone().split("-").map(Number);
  const today = new Date(todayYear, todayMonth - 1, todayDay);

  const daysLeft = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (daysLeft < 0) return "overdue";
  if (daysLeft <= dueSoonDays) return "soon";
  return "ok";
}
