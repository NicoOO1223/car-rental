import { History } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/format";
import type { AuditLogEntry } from "@/lib/api";
import { t } from "@/lib/i18n";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit";

/**
 * A dense, single-line-per-entry feed, in place of DataTable's card/table
 * rows — those were built for a handful of rich rows, not a chronological
 * event stream where scanning as much history per screen as possible is
 * the whole point.
 */

function entityLabel(entry: AuditLogEntry): string {
  const type = auditEntityLabel(entry.entity_type);

  if (!entry.entity_id) return type;
  return `${type}·${entry.entity_id.slice(0, 8).toUpperCase()}`;
}

const LOADING_ROW_COUNT = 8;

export function AuditLogFeed({
  entries,
  loading,
  isFiltered,
}: {
  entries: AuditLogEntry[];
  loading: boolean;
  isFiltered: boolean;
}) {
  if (!loading && entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={t("c.auditLog.AuditLogFeed.noAuditLogEntries")}
        description={
          isFiltered
            ? t("c.auditLog.AuditLogFeed.tryChangingFilters")
            : t("c.auditLog.AuditLogFeed.entriesAppearHereAs")
        }
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-sm">
      <div className="divide-y divide-border-subtle">
        {loading
          ? Array.from({ length: LOADING_ROW_COUNT }).map((_, index) => (
              <div key={index} className="px-4 py-1.5">
                <Skeleton className="h-3.5 w-full max-w-2xl" />
              </div>
            ))
          : entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-1.5 text-xs sm:text-sm"
              >
                <span className="shrink-0 tabular-nums text-ink-muted">
                  {formatDateTime(entry.created_at)}
                </span>

                <span className="min-w-0 max-w-[14rem] truncate text-ink-secondary">
                  {entry.user_email ?? t("c.auditLog.AuditLogFeed.systemDeletedUser")}
                </span>

                <span className="shrink-0 text-ink">
                  {auditActionLabel(entry.action)}
                </span>

                <span className="shrink-0 text-ink-muted">
                  {entityLabel(entry)}
                </span>

                {entry.details && (
                  <code
                    className="min-w-0 truncate text-ink-muted"
                    title={JSON.stringify(entry.details)}
                  >
                    {JSON.stringify(entry.details)}
                  </code>
                )}
              </div>
            ))}
      </div>
    </div>
  );
}
