"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select, Textarea } from "@/components/ui/Field";
import { getEmailParts, getEmailStatus, resetEmailPart, saveEmailPart, type EmailPartRow } from "@/lib/api";
import { enumLabel, t } from "@/lib/i18n";

function languageName(code: string): string {
  return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
}

/**
 * The optional bits of the emails (what was paid online, the cancellation policy, what to
 * bring, the link to manage a booking, the sign-off), worded once per language and dropped
 * into messages as {name}. A part that has nothing to say, or that is left empty here, takes
 * its line out of the email.
 */
export function EmailPartsEditor() {
  const [parts, setParts] = useState<EmailPartRow[] | null>(null);
  const [language, setLanguage] = useState("en");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;

    Promise.all([getEmailParts(), getEmailStatus()])
      .then(([rows, status]) => {
        if (cancelled) return;
        setParts(rows);
        setLanguage(status.default_language);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedLoad"));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const draftKey = (key: string) => `${language}:${key}`;

  function clear(key: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[draftKey(key)];

      return next;
    });
  }

  async function act(row: EmailPartRow, action: () => Promise<EmailPartRow[]>) {
    setBusyKey(draftKey(row.key));
    setErrors((current) => ({ ...current, [draftKey(row.key)]: "" }));

    try {
      setParts(await action());
      clear(row.key);
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [draftKey(row.key)]: err instanceof Error ? err.message : t("s.admin.configuration.email.failedSave"),
      }));
    } finally {
      setBusyKey(null);
    }
  }

  if (!parts) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.email.reusableTitle")}</h2>

        {loadError ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {loadError}
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-secondary">{t("s.admin.configuration.email.loading")}</p>
        )}
      </Card>
    );
  }

  const languages = Object.keys(parts[0].languages);

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.email.reusableTitle")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.email.reusableIntro")}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor="parts-language" className="text-sm font-medium text-ink">
          {t("s.admin.configuration.email.editingLanguage")}
        </label>

        <Select id="parts-language" className="w-48" value={language} onChange={(event) => setLanguage(event.target.value)}>
          {languages.map((code) => (
            <option key={code} value={code}>
              {languageName(code)}
            </option>
          ))}
        </Select>
      </div>

      <ul className="mt-4 divide-y divide-border-subtle">
        {parts.map((row) => {
          const key = draftKey(row.key);
          const view = row.languages[language];
          const value = drafts[key] ?? view.text;
          const dirty = value !== view.text;
          const busy = busyKey === key;
          const id = `email-part-${row.key}`;

          return (
            <li key={row.key} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={id} className="text-sm font-medium text-ink">
                  <span className="font-mono text-xs text-ink-muted">{`{${row.part}}`}</span>{" "}
                  {enumLabel("emailPart", row.key)}
                </label>

                {view.customised && (
                  <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink-secondary">
                    {view.text === "" ? t("s.admin.configuration.email.leftOut") : t("s.admin.configuration.email.customised")}
                  </span>
                )}
              </div>

              <p className="mt-1 text-xs text-ink-muted">
                {t("s.admin.configuration.email.usedIn", {
                  emails: row.used_by.map((type) => enumLabel("emailTemplate", type)).join(", "),
                })}
                {row.values.length > 0 &&
                  ` · ${t("s.admin.configuration.email.canUse", { names: row.values.map((name) => `{${name}}`).join(" ") })}`}
              </p>

              <Textarea
                id={id}
                className="mt-2"
                rows={Math.min(6, Math.max(2, value.split("\n").length + 1))}
                value={value}
                maxLength={2000}
                invalid={!!errors[key]}
                onChange={(event) => setDrafts({ ...drafts, [key]: event.target.value })}
              />

              {value === "" && <p className="mt-1 text-xs text-ink-muted">{t("s.admin.configuration.email.emptyMeansLeftOut")}</p>}

              {errors[key] && (
                <p className="mt-1.5 text-xs text-red-600" role="alert">
                  {errors[key]}
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" disabled={!dirty} loading={busy} onClick={() => act(row, () => saveEmailPart(row.key, language, value))}>
                  {t("s.admin.configuration.email.save")}
                </Button>

                {view.customised && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(row, () => resetEmailPart(row.key, language))}>
                    {t("s.admin.configuration.email.resetToDefault")}
                  </Button>
                )}

                {dirty && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => clear(row.key)}>
                    {t("s.admin.configuration.email.discard")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
