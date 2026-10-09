import { History } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/format";
import type { AuditLogEntry } from "@/lib/api";
import { t } from "@/lib/i18n";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit";

/**
 * A dense, one-line-per-entry log, not DataTable's roomy rows: this is a
 * chronological stream, and fitting as much history on a screen as possible
 * is the point. From `lg` up the entries line up in columns under headings;
 * below that each entry wraps onto a couple of short lines.
 */

function entityLabel(entry: AuditLogEntry): string {
  const type = auditEntityLabel(entry.entity_type);

  if (!entry.entity_id) return type;
  return `${type} · ${entry.entity_id.slice(0, 8).toUpperCase()}`;
}

const LOADING_ROW_COUNT = 8;

// When, who, what they did, to what, and the recorded detail.
const COLUMNS = "lg:grid lg:grid-cols-[11.5rem_minmax(0,14rem)_minmax(0,16rem)_minmax(0,13rem)_minmax(0,1fr)] lg:gap-x-4";

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
    <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface" role="table">
      <div
        role="row"
        className={`hidden border-b border-border-subtle px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted ${COLUMNS}`}
      >
        <span role="columnheader">{t("c.auditLog.AuditLogFeed.when")}</span>
        <span role="columnheader">{t("c.auditLog.AuditLogFeed.who")}</span>
        <span role="columnheader">{t("c.auditLog.AuditLogFeed.action")}</span>
        <span role="columnheader">{t("c.auditLog.AuditLogFeed.subject")}</span>
        <span role="columnheader">{t("c.auditLog.AuditLogFeed.details")}</span>
      </div>

      <div className="divide-y divide-border-subtle" role="rowgroup">
        {loading
          ? Array.from({ length: LOADING_ROW_COUNT }).map((_, index) => (
              <div key={index} className="px-5 py-2">
                <Skeleton className="h-3.5 w-full max-w-2xl" />
              </div>
            ))
          : entries.map((entry) => (
              <div
                key={entry.id}
                role="row"
                className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2 text-xs transition-colors hover:bg-accent-soft sm:text-sm ${COLUMNS}`}
              >
                <span role="cell" className="shrink-0 tabular-nums text-ink-muted">
                  {formatDateTime(entry.created_at)}
                </span>

                <span role="cell" className="min-w-0 truncate text-ink-secondary" title={entry.user_email ?? undefined}>
                  {entry.user_email ?? t("c.auditLog.AuditLogFeed.systemDeletedUser")}
                </span>

                <span role="cell" className="min-w-0 truncate font-medium text-ink">
                  {auditActionLabel(entry.action)}
                </span>

                <span role="cell" className="min-w-0 truncate text-ink-muted">
                  {entityLabel(entry)}
                </span>

                <span role="cell" className="min-w-0">
                  {entry.details && (
                    <code className="block truncate font-mono text-xs text-ink-muted" title={JSON.stringify(entry.details)}>
                      {JSON.stringify(entry.details)}
                    </code>
                  )}
                </span>
              </div>
            ))}
      </div>
    </div>
  );
}
