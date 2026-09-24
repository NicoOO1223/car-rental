export const MAINTENANCE_CATEGORIES = [
  { value: "DAMAGE_REPAIR", label: "Damage repair" },
  { value: "TECHNICAL_INSPECTION", label: "Technical inspection" },
  { value: "ROUTINE_SERVICE", label: "Routine service" },
  { value: "OTHER", label: "Other" },
] as const;

export function maintenanceCategoryLabel(
  category: string | null | undefined,
): string {
  return (
    MAINTENANCE_CATEGORIES.find((item) => item.value === category)?.label ?? ""
  );
}

const INSPECTION_SOON_DAYS = 30;

/** How a car's next technical inspection date stands relative to today. */
export function inspectionStatus(
  nextDue: string | null | undefined,
): "overdue" | "soon" | "ok" | null {
  if (!nextDue) return null;

  const [year, month, day] = nextDue.split("-").map(Number);
  const due = new Date(year, month - 1, day);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysLeft = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (daysLeft < 0) return "overdue";
  if (daysLeft <= INSPECTION_SOON_DAYS) return "soon";
  return "ok";
}
