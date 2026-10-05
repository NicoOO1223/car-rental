"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getEmailTypes, updateEmailType, type EmailTypeRow } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { enumLabel, t } from "@/lib/i18n";

const AUDIENCES: EmailTypeRow["audience"][] = ["renter", "business", "account"];

/** Every email the system sends, grouped by who gets it, with an on/off switch and a link to its editor. */
export function EmailTypeList() {
  const [rows, setRows] = useState<EmailTypeRow[] | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getEmailTypes()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedLoad"));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(row: EmailTypeRow) {
    const setEnabled = (enabled: boolean) =>
      setRows((current) => current?.map((item) => (item.key === row.key ? { ...item, enabled } : item)) ?? current);

    setBusyKey(row.key);
    setError("");
    // The switch moves at once; it goes back if the server says no.
    setEnabled(!row.enabled);

    try {
      await updateEmailType(row.key, { enabled: !row.enabled });
    } catch (err) {
      setEnabled(row.enabled);
      setError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedSave"));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.email.emailsTitle")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.email.emailsIntro")}</p>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {!rows && !error && <p className="mt-4 text-sm text-ink-secondary">{t("s.admin.configuration.email.loading")}</p>}

      {rows &&
        AUDIENCES.map((audience) => {
          const group = rows.filter((row) => row.audience === audience);

          if (group.length === 0) return null;

          return (
            <section key={audience} className="mt-6" aria-labelledby={`email-audience-${audience}`}>
              <h3 id={`email-audience-${audience}`} className="text-sm font-semibold text-ink">
                {enumLabel("emailAudience", audience)}
              </h3>

              <ul className="mt-2 divide-y divide-border-subtle rounded-lg border border-border-subtle">
                {group.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/configuration/email/${row.key}`}
                        className="font-medium text-ink underline-offset-2 hover:underline"
                      >
                        {enumLabel("emailTemplate", row.key)}
                      </Link>

                      <p className="mt-0.5 text-sm text-ink-secondary">{enumLabel("emailWhen", row.key)}</p>

                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                        {row.customised_languages.length > 0 && (
                          <Badge colorClass="bg-surface-sunken text-ink-secondary">
                            {t("s.admin.configuration.email.customisedIn", { languages: row.customised_languages.join(", ").toUpperCase() })}
                          </Badge>
                        )}

                        {row.last_sent_at
                          ? t("s.admin.configuration.email.lastSentAt", { when: formatDateTime(row.last_sent_at) })
                          : t("s.admin.configuration.email.neverSent")}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <Link
                        href={`/admin/configuration/email/${row.key}`}
                        className="text-sm font-medium text-ink underline-offset-2 hover:underline"
                      >
                        {t("s.admin.configuration.email.edit")}
                      </Link>

                      {row.can_disable ? (
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            role="switch"
                            className="h-4 w-4 accent-gray-900"
                            checked={row.enabled}
                            disabled={busyKey === row.key}
                            onChange={() => toggle(row)}
                          />
                          <span className="text-ink-secondary">
                            {row.enabled ? t("s.admin.configuration.email.on") : t("s.admin.configuration.email.off")}
                          </span>
                          <span className="sr-only">{enumLabel("emailTemplate", row.key)}</span>
                        </label>
                      ) : (
                        <span className="text-sm text-ink-muted">{t("s.admin.configuration.email.alwaysOn")}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </Card>
  );
}
