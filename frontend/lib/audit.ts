import { hasMessage, humanize, t } from "@/lib/i18n";

/** The words for an audited action ("reservation.cancelled"). The stored value never changes. */
export function auditActionLabel(action: string): string {
  const key = `audit.action.${action}`;

  return hasMessage(key) ? t(key) : humanize(action.replace(/[._]/g, " "));
}

/** The words for an audited entity type ("check_out"). */
export function auditEntityLabel(entityType: string): string {
  const key = `audit.entity.${entityType}`;

  return hasMessage(key) ? t(key) : humanize(entityType);
}
