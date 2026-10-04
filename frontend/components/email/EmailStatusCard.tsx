"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { getEmailStatus, sendTestEmail, setEmailPaused, type EmailStatus } from "@/lib/api";
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

/**
 * Is email working? Whether it is set up at all is decided when the stack is
 * provisioned (the sending domain has to be created and verified in Azure, which
 * the application has no rights to do); everything else is here.
 */
export function EmailStatusCard({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [testAddress, setTestAddress] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ sent: boolean; error: string | null; to: string } | null>(null);
  const [testError, setTestError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getEmailStatus()
      .then((data) => {
        if (!cancelled) setStatus(data);
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
          <p className="mt-4 text-sm text-red-600" role="alert">
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
            <Row label={t("s.admin.configuration.email.sentIn")}>
              {new Intl.DisplayNames([status.language], { type: "language" }).of(status.language)}
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
              <span className={status.failed > 0 ? "text-red-600" : ""}>{status.failed}</span>
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
              <div className="mt-3 text-sm text-red-600" role="alert">
                <p>{t("s.admin.configuration.email.testFailed", { to: testResult.to })}</p>
                <p className="mt-1 break-words font-mono text-xs">{testResult.error}</p>
              </div>
            )}

            {testError && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {testError}
              </p>
            )}
          </form>
        </>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
