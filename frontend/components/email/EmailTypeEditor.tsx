"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input, Textarea } from "@/components/ui/Field";
import {
  getEmailStatus,
  getEmailType,
  previewEmail,
  resetEmailTemplate,
  saveEmailTemplate,
  sendTestEmail,
  updateEmailType,
  type EmailTypeDetail,
} from "@/lib/api";
import { enumLabel, t } from "@/lib/i18n";

function languageName(code: string): string {
  return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
}

type Field = "subject" | "body";
type Draft = { subject: string; body: string };

/**
 * One email, one language at a time: a subject and a body written as ordinary text.
 * Click a value to put {its name} where the cursor is; parts (the optional bits that
 * only appear when they apply) are dropped in the same way and edited under
 * "Reusable parts". Preview and a real test send use sample values.
 */
export function EmailTypeEditor({ typeKey }: { typeKey: string }) {
  const [detail, setDetail] = useState<EmailTypeDetail | null>(null);
  const [language, setLanguage] = useState("en");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "reset" | "toggle" | "test" | null>(null);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [testAddress, setTestAddress] = useState("");
  const [testResult, setTestResult] = useState<{ sent: boolean; error: string | null; to: string } | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<Field>("body");

  useEffect(() => {
    let cancelled = false;

    Promise.all([getEmailType(typeKey), getEmailStatus()])
      .then(([data, status]) => {
        if (cancelled) return;
        setDetail(data);
        setLanguage(status.default_language in data.languages ? status.default_language : "en");
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedLoad"));
      });

    return () => {
      cancelled = true;
    };
  }, [typeKey]);

  if (!detail) {
    return (
      <Card>
        {loadError ? (
          <p className="text-sm text-red-600" role="alert">
            {loadError}
          </p>
        ) : (
          <p className="text-sm text-ink-secondary">{t("s.admin.configuration.email.loading")}</p>
        )}
      </Card>
    );
  }

  const saved = detail.languages[language];
  const draft = drafts[language] ?? { subject: saved.subject, body: saved.body };
  const dirty = draft.subject !== saved.subject || draft.body !== saved.body;

  function setDraft(next: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [language]: { ...draft, ...next } }));
  }

  /** Puts {name} at the cursor of the field that was last used. */
  function insert(name: string, onlyBody = false) {
    const field: Field = onlyBody ? "body" : lastField.current;
    const element = field === "subject" ? subjectRef.current : bodyRef.current;
    const current = draft[field];
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    const token = `{${name}}`;

    setDraft({ [field]: current.slice(0, start) + token + current.slice(end) });

    // Put the cursor after the token once React has rendered the new text.
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind);
    setError("");

    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedSave"));
    } finally {
      setBusy(null);
    }
  }

  const clearDraft = () =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[language];

      return next;
    });

  const save = () =>
    run("save", async () => {
      setDetail(await saveEmailTemplate(typeKey, language, draft.subject, draft.body));
      clearDraft();
    });

  const reset = () =>
    run("reset", async () => {
      setDetail(await resetEmailTemplate(typeKey, language));
      clearDraft();
    });

  // A switch moves at once and goes back if the server refuses.
  const toggleEnabled = () => {
    const before = detail;

    setDetail({ ...detail, enabled: !detail.enabled });

    return run("toggle", async () => {
      try {
        setDetail(await updateEmailType(typeKey, { enabled: !before.enabled }));
      } catch (err) {
        setDetail(before);
        throw err;
      }
    });
  };

  const setOption = (name: string, value: boolean | number) => {
    const before = detail;

    setDetail({ ...detail, options: { ...detail.options, [name]: value } });

    return run("toggle", async () => {
      try {
        setDetail(await updateEmailType(typeKey, { options: { [name]: value } }));
      } catch (err) {
        setDetail(before);
        throw err;
      }
    });
  };

  async function openPreview() {
    setError("");

    try {
      setPreview(await previewEmail({ type: typeKey, language, subject: draft.subject, body: draft.body }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedPreview"));
    }
  }

  const test = () =>
    run("test", async () => {
      // The test shows the email as saved, so unsaved edits are not what is sent.
      setTestResult(await sendTestEmail(testAddress.trim() || null, typeKey, language));
    });

  return (
    <div className="space-y-6">
      <Link href="/admin/configuration/email" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("s.admin.configuration.email.backToEmails")}
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">{enumLabel("emailTemplate", typeKey)}</h2>
            <p className="mt-1 text-sm text-ink-secondary">{enumLabel("emailWhen", typeKey)}</p>
          </div>

          {detail.can_disable ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                className="h-4 w-4 accent-gray-900"
                checked={detail.enabled}
                disabled={busy === "toggle"}
                onChange={toggleEnabled}
              />
              <span className="text-ink">{detail.enabled ? t("s.admin.configuration.email.on") : t("s.admin.configuration.email.off")}</span>
            </label>
          ) : (
            <span className="text-sm text-ink-muted">{t("s.admin.configuration.email.alwaysOn")}</span>
          )}
        </div>

        {!detail.enabled && (
          <p className="mt-3 text-sm text-ink-secondary" role="status">
            {t("s.admin.configuration.email.offExplanation")}
          </p>
        )}

        {Object.entries(detail.option_kinds).map(([name, kind]) =>
          kind === "bool" ? (
            <label key={name} className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-gray-900"
                checked={detail.options[name] === true}
                disabled={busy === "toggle"}
                onChange={(event) => void setOption(name, event.target.checked)}
              />
              <span className="text-ink">{enumLabel("emailOption", name)}</span>
            </label>
          ) : null,
        )}
      </Card>

      <Card>
        <div role="tablist" aria-label={t("s.admin.configuration.email.languageTabs")} className="flex flex-wrap gap-2">
          {Object.keys(detail.languages).map((code) => {
            const selected = code === language;

            return (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setLanguage(code)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  selected ? "bg-gray-900 text-white" : "bg-surface-sunken text-ink-secondary hover:text-ink"
                }`}
              >
                {languageName(code)}
                {detail.languages[code].customised && <span aria-hidden="true"> •</span>}
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-xs text-ink-muted">{t("s.admin.configuration.email.languageHelp")}</p>

        <div className="mt-5">
          <label htmlFor="email-subject" className="block text-sm font-medium text-ink">
            {t("s.admin.configuration.email.subject")}
          </label>

          <Input
            id="email-subject"
            ref={subjectRef}
            className="mt-2"
            value={draft.subject}
            maxLength={300}
            onFocus={() => (lastField.current = "subject")}
            onChange={(event) => setDraft({ subject: event.target.value })}
          />
        </div>

        <div className="mt-5">
          <label htmlFor="email-body" className="block text-sm font-medium text-ink">
            {t("s.admin.configuration.email.message")}
          </label>

          <Textarea
            id="email-body"
            ref={bodyRef}
            className="mt-2 font-mono text-[13px] leading-relaxed"
            rows={Math.min(24, Math.max(10, draft.body.split("\n").length + 2))}
            value={draft.body}
            maxLength={8000}
            onFocus={() => (lastField.current = "body")}
            onChange={(event) => setDraft({ body: event.target.value })}
          />
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-ink">{t("s.admin.configuration.email.valuesTitle")}</p>
          <p className="mt-1 text-xs text-ink-muted">{t("s.admin.configuration.email.valuesHelp")}</p>

          <div className="mt-2 flex flex-wrap gap-2">
            {[...detail.values, ...detail.global_values].map((name) => (
              <button
                key={name}
                type="button"
                title={enumLabel("emailValue", name)}
                onClick={() => insert(name)}
                className="rounded-md border border-border-strong bg-white px-2 py-1 font-mono text-xs text-ink-secondary hover:bg-surface-sunken hover:text-ink"
              >
                {`{${name}}`}
              </button>
            ))}
          </div>
        </div>

        {detail.parts.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-ink">{t("s.admin.configuration.email.partsTitle")}</p>
            <p className="mt-1 text-xs text-ink-muted">{t("s.admin.configuration.email.partsHelp")}</p>

            <div className="mt-2 flex flex-wrap gap-2">
              {detail.parts.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={enumLabel("emailPart", name)}
                  onClick={() => insert(name, true)}
                  className="rounded-md border border-dashed border-border-strong bg-white px-2 py-1 font-mono text-xs text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                >
                  {`{${name}}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={save} disabled={!dirty} loading={busy === "save"}>
            {t("s.admin.configuration.email.save")}
          </Button>

          <Button variant="secondary" onClick={openPreview}>
            {t("s.admin.configuration.email.preview")}
          </Button>

          {saved.customised && (
            <Button variant="ghost" onClick={reset} loading={busy === "reset"}>
              {t("s.admin.configuration.email.resetToDefault")}
            </Button>
          )}

          {dirty && (
            <Button variant="ghost" onClick={clearDraft}>
              {t("s.admin.configuration.email.discard")}
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-ink">{t("s.admin.configuration.email.testThisTitle")}</h3>
        <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.email.testThisIntro")}</p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="email-test-address" className="block text-sm font-medium text-ink">
              {t("s.admin.configuration.email.testAddress")}
            </label>
            <Input
              id="email-test-address"
              type="email"
              className="mt-2 w-72 max-w-full"
              placeholder={t("s.admin.configuration.email.testAddressPlaceholder")}
              value={testAddress}
              onChange={(event) => setTestAddress(event.target.value)}
            />
          </div>

          <Button onClick={test} loading={busy === "test"}>
            {t("s.admin.configuration.email.sendThisTest")}
          </Button>
        </div>

        {dirty && <p className="mt-2 text-xs text-ink-muted">{t("s.admin.configuration.email.testSavedOnly")}</p>}

        {testResult?.sent && (
          <p className="mt-3 text-sm text-ink" role="status">
            {t("s.admin.configuration.email.testSent", { to: testResult.to })}
          </p>
        )}

        {testResult && !testResult.sent && (
          <div className="mt-3 text-sm text-red-600" role="alert">
            <p>{t("s.admin.configuration.email.testFailed", { to: testResult.to })}</p>
            <p className="mt-1 break-words font-mono text-xs">{testResult.error}</p>
          </div>
        )}
      </Card>

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
    </div>
  );
}
