"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { getEmailMessages, retryEmailMessage, type EmailMessageItem } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { enumLabel, t } from "@/lib/i18n";

const STATUS_STYLE: Record<string, string> = {
  SENT: "bg-surface-sunken text-ink-secondary",
  PENDING: "bg-warning-soft text-warning",
  FAILED: "bg-danger-soft text-danger",
};

/** The most recent emails the system has sent or tried to, and a way to send a failed one again. */
export function EmailMessageLog({ refreshKey = 0 }: { refreshKey?: number }) {
  const [messages, setMessages] = useState<EmailMessageItem[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Fetches on mount and whenever the filter, the reload counter or the refresh
    // key changes; state is only set once the answer is in.
    getEmailMessages(filter || undefined)
      .then((data) => {
        if (cancelled) return;
        setError("");
        setMessages(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedLoad"));
      });

    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey, refreshKey]);

  async function retry(message: EmailMessageItem) {
    setRetryingId(message.id);
    setError("");

    try {
      await retryEmailMessage(message.id);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedSave"));
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.email.logTitle")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.email.logIntro")}</p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="email-log-filter" className="sr-only">
            {t("s.admin.configuration.email.filterStatus")}
          </label>

          <Select id="email-log-filter" className="w-44" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">{t("s.admin.configuration.email.allStatuses")}</option>
            <option value="FAILED">{enumLabel("emailStatus", "FAILED")}</option>
            <option value="PENDING">{enumLabel("emailStatus", "PENDING")}</option>
            <option value="SENT">{enumLabel("emailStatus", "SENT")}</option>
          </Select>

          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            {t("s.admin.configuration.email.refresh")}
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {messages && messages.length === 0 && !error && (
        <p className="mt-6 text-sm text-ink-secondary">{t("s.admin.configuration.email.logEmpty")}</p>
      )}

      {messages && messages.length > 0 && (
        <ul className="mt-4 divide-y divide-border-subtle">
          {messages.map((message) => (
            <li key={message.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-ink">{message.subject}</p>

                <Badge colorClass={STATUS_STYLE[message.status] ?? STATUS_STYLE.PENDING}>
                  {enumLabel("emailStatus", message.status)}
                </Badge>
              </div>

              <p className="mt-0.5 text-xs text-ink-muted">
                {enumLabel("emailTemplate", message.template)} · {message.to_address} ·{" "}
                {message.sent_at
                  ? t("s.admin.configuration.email.sentAt", { when: formatDateTime(message.sent_at) })
                  : t("s.admin.configuration.email.createdAt", { when: formatDateTime(message.created_at) })}
                {message.status !== "SENT" && message.attempts > 0 && (
                  <> · {t("s.admin.configuration.email.tries", { count: message.attempts })}</>
                )}
              </p>

              {message.last_error && message.status !== "SENT" && (
                <p className="mt-1 break-words font-mono text-xs text-danger">{message.last_error}</p>
              )}

              {message.status === "FAILED" && (
                <Button className="mt-2" variant="secondary" size="sm" loading={retryingId === message.id} onClick={() => retry(message)}>
                  {t("s.admin.configuration.email.retry")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
