"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea, TextField } from "@/components/ui/Field";
import {
  getEmailStatus,
  sendTestEmail,
  setEmailAlertRecipients,
  setEmailPaused,
  setEmailReplyTo,
  type EmailStatus,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 py-2 text-sm">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  );
}

function languageName(code: string): string {
  return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
}

/**
 * Is email working, and where do replies go? Whether it is set up at all is decided
 * when the stack is provisioned (the sending domain has to be created and verified in
 * Azure, which the application has no rights to do); everything else is here.
 */
export function EmailStatusCard({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [savingReplyTo, setSavingReplyTo] = useState(false);
  const [replyToError, setReplyToError] = useState("");

  const [alerts, setAlerts] = useState("");
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [alertsError, setAlertsError] = useState("");

  const [testAddress, setTestAddress] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ sent: boolean; error: string | null; to: string } | null>(null);
  const [testError, setTestError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getEmailStatus()
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        setReplyTo(data.reply_to ?? "");
        setAlerts(data.alert_recipients.join("\n"));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedLoad"));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function togglePause() {
    if (!status) return;

    setBusy(true);
    setError("");

    try {
      setStatus(await setEmailPaused(!status.paused));
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedSave"));
    } finally {
      setBusy(false);
    }
  }

  async function saveReplyTo(event: React.FormEvent) {
    event.preventDefault();

    setSavingReplyTo(true);
    setReplyToError("");

    try {
      const updated = await setEmailReplyTo(replyTo?.trim() || null);
      setStatus(updated);
      setReplyTo(updated.reply_to ?? "");
    } catch (err) {
      setReplyToError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedSave"));
    } finally {
      setSavingReplyTo(false);
    }
  }

  const alertLines = (text: string) =>
    text
      .split(/[\n,;]+/)
      .map((line) => line.trim())
      .filter(Boolean);

  async function saveAlerts(event: React.FormEvent) {
    event.preventDefault();

    setSavingAlerts(true);
    setAlertsError("");

    try {
      const updated = await setEmailAlertRecipients(alertLines(alerts));
      setStatus(updated);
      setAlerts(updated.alert_recipients.join("\n"));
    } catch (err) {
      setAlertsError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedSave"));
    } finally {
      setSavingAlerts(false);
    }
  }

  async function handleTest(event: React.FormEvent) {
    event.preventDefault();

    setTesting(true);
    setTestResult(null);
    setTestError("");

    try {
      setTestResult(await sendTestEmail(testAddress.trim() || null));
    } catch (err) {
      setTestError(err instanceof Error ? err.message : t("s.admin.configuration.email.failedTest"));
    } finally {
      setTesting(false);
    }
  }

  if (!status) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.email.statusTitle")}</h2>

        {error ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-secondary">{t("s.admin.configuration.email.loading")}</p>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.email.statusTitle")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.email.statusIntro")}</p>

      {!status.set_up ? (
        <div className="mt-4 rounded-lg bg-surface-sunken p-4 text-sm text-ink-secondary" role="status">
          <p className="font-medium text-ink">{t("s.admin.configuration.email.notSetUp")}</p>
          <p className="mt-1">{t("s.admin.configuration.email.notSetUpSteps")}</p>
        </div>
      ) : (
        <>
          <dl className="mt-4 divide-y divide-border-subtle">
            <Row label={t("s.admin.configuration.email.state")}>
              {status.paused ? t("s.admin.configuration.email.statePaused") : t("s.admin.configuration.email.stateOn")}
            </Row>
            <Row label={t("s.admin.configuration.email.sentFrom")}>{status.from_address}</Row>
            <Row label={t("s.admin.configuration.email.defaultLanguage")}>{languageName(status.default_language)}</Row>
            <Row label={t("s.admin.configuration.email.links")}>
              {status.storefront_url ?? t("s.admin.configuration.email.noLinks")}
            </Row>
            <Row label={t("s.admin.configuration.email.sentLast7")}>{status.sent_last_7_days}</Row>
            <Row label={t("s.admin.configuration.email.waiting")}>
              {status.pending}
              {status.oldest_pending_at && (
                <span className="ml-2 font-normal text-ink-muted">
                  {t("s.admin.configuration.email.oldest", { when: formatDateTime(status.oldest_pending_at) })}
                </span>
              )}
            </Row>
            <Row label={t("s.admin.configuration.email.gaveUp")}>
              <span className={status.failed > 0 ? "text-danger" : ""}>{status.failed}</span>
            </Row>
            <Row label={t("s.admin.configuration.email.lastSent")}>
              {status.last_sent_at ? formatDateTime(status.last_sent_at) : "—"}
            </Row>
            <Row label={t("s.admin.configuration.email.sender")}>
              {status.worker_running ? t("s.admin.configuration.email.senderRunning") : t("s.admin.configuration.email.senderStopped")}
            </Row>
          </dl>

          {status.paused && (
            <p className="mt-3 text-sm text-ink-secondary" role="status">
              {t("s.admin.configuration.email.pausedExplanation")}
            </p>
          )}

          <div className="mt-4">
            <Button variant="secondary" onClick={togglePause} loading={busy}>
              {status.paused ? t("s.admin.configuration.email.resume") : t("s.admin.configuration.email.pause")}
            </Button>
          </div>

          <form onSubmit={saveReplyTo} className="mt-6 border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold text-ink">{t("s.admin.configuration.email.replyToTitle")}</h3>
            <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.email.replyToIntro")}</p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <TextField
                label={t("s.admin.configuration.email.replyTo")}
                type="email"
                className="w-72 max-w-full"
                placeholder={status.reply_to_default ?? t("s.admin.configuration.email.replyToNone")}
                value={replyTo ?? ""}
                error={replyToError || undefined}
                onChange={(event) => setReplyTo(event.target.value)}
              />

              <Button type="submit" variant="secondary" loading={savingReplyTo} disabled={(replyTo ?? "") === (status.reply_to ?? "")}>
                {t("s.admin.configuration.email.save")}
              </Button>
            </div>
          </form>

          <form onSubmit={saveAlerts} className="mt-6 border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold text-ink">{t("s.admin.configuration.email.alertsTitle")}</h3>
            <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.email.alertsIntro")}</p>

            <label htmlFor="email-alert-recipients" className="mt-3 block text-sm font-medium text-ink">
              {t("s.admin.configuration.email.alertsLabel")}
            </label>
            <Textarea
              id="email-alert-recipients"
              className="mt-2 w-96 max-w-full"
              rows={4}
              placeholder={t("s.admin.configuration.email.alertsPlaceholder")}
              value={alerts}
              invalid={Boolean(alertsError)}
              onChange={(event) => setAlerts(event.target.value)}
            />

            {alertsError && (
              <p className="mt-1 text-sm text-danger" role="alert">
                {alertsError}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="secondary"
                loading={savingAlerts}
                disabled={alertLines(alerts).join("\n") === status.alert_recipients.join("\n")}
              >
                {t("s.admin.configuration.email.save")}
              </Button>
              <span className="text-xs text-ink-muted">
                {t("s.admin.configuration.email.alertsCount", { count: alertLines(alerts).length, max: 5 })}
              </span>
            </div>
          </form>

          <form onSubmit={handleTest} className="mt-6 border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold text-ink">{t("s.admin.configuration.email.testTitle")}</h3>
            <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.email.testIntro")}</p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <TextField
                label={t("s.admin.configuration.email.testAddress")}
                type="email"
                className="w-72 max-w-full"
                placeholder={t("s.admin.configuration.email.testAddressPlaceholder")}
                value={testAddress}
                onChange={(event) => setTestAddress(event.target.value)}
              />

              <Button type="submit" loading={testing}>
                {t("s.admin.configuration.email.sendTest")}
              </Button>
            </div>

            {testResult && testResult.sent && (
              <p className="mt-3 text-sm text-ink" role="status">
                {t("s.admin.configuration.email.testSent", { to: testResult.to })}
              </p>
            )}

            {testResult && !testResult.sent && (
              <div className="mt-3 text-sm text-danger" role="alert">
                <p>{t("s.admin.configuration.email.testFailed", { to: testResult.to })}</p>
                <p className="mt-1 break-words font-mono text-xs">{testResult.error}</p>
              </div>
            )}

            {testError && (
              <p className="mt-3 text-sm text-danger" role="alert">
                {testError}
              </p>
            )}
          </form>
        </>
      )}

      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
