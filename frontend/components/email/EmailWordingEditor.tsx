"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Select, Textarea, Input } from "@/components/ui/Field";
import {
  getEmailTexts,
  previewEmail,
  resetEmailText,
  saveEmailText,
  type EmailTextLine,
  type EmailTexts,
} from "@/lib/api";
import { enumLabel, t } from "@/lib/i18n";

// The email each group of lines belongs to, for the preview. The shared lines
// (greeting, contact, sign-off) appear in all three, so they preview with the first.
const PREVIEW_TEMPLATE: Record<string, string> = {
  shared: "booking_confirmed",
  booking_confirmed: "booking_confirmed",
  booking_cancelled: "booking_cancelled",
  receipt: "receipt",
};

function languageName(code: string): string {
  return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
}

type Preview = { template: string; subject: string; body: string } | null;

/**
 * Every subject and line of the emails renters get, in each language. A line left
 * as it is uses the built-in wording; saving one replaces it for that language; an
 * empty line (not a subject) is left out of the email.
 */
export function EmailWordingEditor() {
  const [texts, setTexts] = useState<EmailTexts | null>(null);
  const [language, setLanguage] = useState("en");
  // Unsaved edits, by "language:key".
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [preview, setPreview] = useState<Preview>(null);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getEmailTexts()
      .then((data) => {
        if (cancelled) return;
        setTexts(data);
        setLanguage(data.sent_in);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedLoad"));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const draftKey = (key: string) => `${language}:${key}`;

  function currentText(line: EmailTextLine): string {
    return drafts[draftKey(line.key)] ?? line.overrides[language] ?? line.defaults[language];
  }

  function isCustom(line: EmailTextLine): boolean {
    return line.overrides[language] !== undefined;
  }

  function isDirty(line: EmailTextLine): boolean {
    const draft = drafts[draftKey(line.key)];

    return draft !== undefined && draft !== (line.overrides[language] ?? line.defaults[language]);
  }

  function setError(key: string, message: string) {
    setErrors((current) => ({ ...current, [draftKey(key)]: message }));
  }

  async function save(line: EmailTextLine) {
    const key = draftKey(line.key);

    setBusyKey(key);
    setError(line.key, "");

    try {
      setTexts(await saveEmailText(language, line.key, drafts[key] ?? currentText(line)));
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];

        return next;
      });
    } catch (err) {
      setError(line.key, err instanceof Error ? err.message : t("s.admin.configuration.email.failedSave"));
    } finally {
      setBusyKey(null);
    }
  }

  async function reset(line: EmailTextLine) {
    const key = draftKey(line.key);

    setBusyKey(key);
    setError(line.key, "");

    try {
      setTexts(await resetEmailText(language, line.key));
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];

        return next;
      });
    } catch (err) {
      setError(line.key, err instanceof Error ? err.message : t("s.admin.configuration.email.failedSave"));
    } finally {
      setBusyKey(null);
    }
  }

  // Unsaved edits in this language, as the preview should see them.
  const edits = useMemo(() => {
    const prefix = `${language}:`;

    return Object.fromEntries(
      Object.entries(drafts)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    );
  }, [drafts, language]);

  async function openPreview(group: string) {
    const template = PREVIEW_TEMPLATE[group];

    setPreviewError("");

    try {
      const result = await previewEmail(template, language, edits);
      setPreview({ template, ...result });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedPreview"));
    }
  }

  if (!texts) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.email.wordingTitle")}</h2>

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

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.email.wordingTitle")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.email.wordingIntro")}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor="email-language" className="text-sm font-medium text-ink">
          {t("s.admin.configuration.email.editingLanguage")}
        </label>

        <Select id="email-language" className="w-48" value={language} onChange={(event) => setLanguage(event.target.value)}>
          {texts.languages.map((code) => (
            <option key={code} value={code}>
              {languageName(code)}
              {code === texts.sent_in ? ` (${t("s.admin.configuration.email.currentlySent")})` : ""}
            </option>
          ))}
        </Select>
      </div>

      <p className="mt-2 text-xs text-ink-muted">{t("s.admin.configuration.email.placeholdersHelp", { example: "{name}" })}</p>

      {previewError && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {previewError}
        </p>
      )}

      <div className="mt-6 space-y-8">
        {texts.groups.map((group) => (
          <section key={group.id} aria-labelledby={`email-group-${group.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`email-group-${group.id}`} className="text-base font-semibold text-ink">
                {enumLabel("emailGroup", group.id)}
              </h3>

              <Button variant="secondary" size="sm" onClick={() => openPreview(group.id)}>
                {t("s.admin.configuration.email.preview")}
              </Button>
            </div>

            {group.id === "shared" && (
              <p className="mt-1 text-xs text-ink-muted">{t("s.admin.configuration.email.sharedHelp")}</p>
            )}

            <ul className="mt-3 divide-y divide-border-subtle">
              {group.lines.map((line) => {
                const key = draftKey(line.key);
                const value = currentText(line);
                const error = errors[key];
                const busy = busyKey === key;
                const id = `email-line-${group.id}-${line.key}`;

                return (
                  <li key={line.key} className="py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor={id} className="text-sm font-medium text-ink">
                        {enumLabel("emailLine", line.key)}
                      </label>

                      {isCustom(line) && (
                        <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink-secondary">
                          {value === "" && !drafts[key]
                            ? t("s.admin.configuration.email.leftOut")
                            : t("s.admin.configuration.email.customised")}
                        </span>
                      )}
                    </div>

                    {line.placeholders.length > 0 && (
                      <p className="mt-1 text-xs text-ink-muted">
                        {t("s.admin.configuration.email.canUse", {
                          names: line.placeholders.map((name) => `{${name}}`).join(" "),
                        })}
                      </p>
                    )}

                    {line.is_subject ? (
                      <Input
                        id={id}
                        className="mt-2"
                        value={value}
                        maxLength={300}
                        invalid={!!error}
                        onChange={(event) => setDrafts({ ...drafts, [key]: event.target.value })}
                      />
                    ) : (
                      <Textarea
                        id={id}
                        className="mt-2"
                        rows={Math.min(8, Math.max(2, value.split("\n").length + 1))}
                        value={value}
                        maxLength={2000}
                        invalid={!!error}
                        onChange={(event) => setDrafts({ ...drafts, [key]: event.target.value })}
                      />
                    )}

                    {!line.is_subject && value === "" && (
                      <p className="mt-1 text-xs text-ink-muted">{t("s.admin.configuration.email.emptyMeansLeftOut")}</p>
                    )}

                    {error && (
                      <p className="mt-1.5 text-xs text-red-600" role="alert">
                        {error}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => save(line)} disabled={!isDirty(line) || busy} loading={busy}>
                        {t("s.admin.configuration.email.save")}
                      </Button>

                      {(isCustom(line) || isDirty(line)) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            if (isCustom(line)) {
                              void reset(line);
                            } else {
                              setDrafts((current) => {
                                const next = { ...current };
                                delete next[key];

                                return next;
                              });
                            }
                          }}
                        >
                          {isCustom(line) ? t("s.admin.configuration.email.resetToDefault") : t("s.admin.configuration.email.discard")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {preview && (
        <Modal
          isOpen
          title={t("s.admin.configuration.email.previewTitle")}
          description={t("s.admin.configuration.email.previewIntro")}
          size="lg"
          onClose={() => setPreview(null)}
          footer={
            <Button variant="secondary" onClick={() => setPreview(null)}>
              {t("s.admin.configuration.email.close")}
            </Button>
          }
        >
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t("s.admin.configuration.email.subject")}</p>
          <p className="mt-1 text-sm font-semibold text-ink">{preview.subject}</p>

          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-muted">{t("s.admin.configuration.email.message")}</p>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-sunken p-4 font-sans text-sm text-ink">{preview.body}</pre>
        </Modal>
      )}
    </Card>
  );
}
