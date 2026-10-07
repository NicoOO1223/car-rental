"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { Turnstile } from "@/components/Turnstile";
import { accountApi } from "@/lib/account";
import { errorMessage } from "@/lib/errors";

const input =
  "mt-1.5 w-full rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900";
const button =
  "w-full rounded-xl bg-accent px-4 py-3.5 text-sm font-semibold text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 disabled:opacity-50";

/** Asks for a reset link. The answer never says whether the address has an account. */
export function ForgotPasswordForm({ language }: { language: string }) {
  const t = useTranslations("accountMail");
  const all = useTranslations();

  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const humanChecked = token !== null && (token !== "" || !window.__RUNTIME_CONFIG__?.turnstileSiteKey);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await accountApi.forgotPassword({ email: email.trim(), captcha_token: token ?? "" });
      setSent(true);
    } catch (failure) {
      setError(errorMessage(all, failure));
      setResetKey((count) => count + 1);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm sm:p-8" role="status">
        <h1 className="text-2xl font-bold tracking-tight">{t("forgotSentTitle")}</h1>
        <p className="mt-3 text-ink-secondary">{t("forgotSentBody", { email: email.trim() })}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight">{t("forgotTitle")}</h1>
      <p className="mt-2 text-ink-secondary">{t("forgotIntro")}</p>

      <div className="mt-6 space-y-4">
        <label className="block text-sm font-medium">
          {t("email")}
          <input
            className={input}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>

        <Turnstile onToken={setToken} resetKey={resetKey} language={language} />
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || !humanChecked} className={`mt-6 ${button}`}>
        {busy ? t("sending") : t("forgotSubmit")}
      </button>

      <p className="mt-5 text-center text-sm text-ink-secondary">
        <Link href={`/${language}/login`} className="font-semibold text-ink underline underline-offset-4">
          {t("backToLogin")}
        </Link>
      </p>
    </form>
  );
}
