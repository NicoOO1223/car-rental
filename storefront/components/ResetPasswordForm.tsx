"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import { accountApi } from "@/lib/account";
import { errorMessage } from "@/lib/errors";

const input =
  "mt-1.5 w-full rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900";
const button =
  "w-full rounded-xl bg-accent px-4 py-3.5 text-sm font-semibold text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 disabled:opacity-50";

/** Choosing a new password with the link from the email (its token is in the address fragment). */
export function ResetPasswordForm({ language }: { language: string }) {
  const t = useTranslations("accountMail");
  const all = useTranslations();

  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "");
    // Out of the address bar and the history.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await accountApi.resetPassword({ token: token ?? "", password });
      setDone(true);
    } catch (failure) {
      setError(errorMessage(all, failure));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm sm:p-8" role="status">
        <h1 className="text-2xl font-bold tracking-tight">{t("resetDoneTitle")}</h1>
        <p className="mt-3 text-ink-secondary">{t("resetDoneBody")}</p>
        <Link href={`/${language}/login`} className="mt-6 inline-block rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-on-accent hover:bg-accent-hover">
          {t("toLogin")}
        </Link>
      </div>
    );
  }

  if (token === "") {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm sm:p-8" role="alert">
        <h1 className="text-2xl font-bold tracking-tight">{t("resetFailedTitle")}</h1>
        <p className="mt-3 text-ink-secondary">{t("linkMissing")}</p>
        <Link href={`/${language}/account/forgot-password`} className="mt-6 inline-block font-semibold underline underline-offset-4">
          {t("askAgain")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight">{t("resetTitle")}</h1>
      <p className="mt-2 text-ink-secondary">{t("resetIntro")}</p>

      <label className="mt-6 block text-sm font-medium">
        {t("newPassword")}
        <input
          className={input}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
        <span className="mt-1 block text-xs font-normal text-ink-muted">{t("passwordHint")}</span>
      </label>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}{" "}
          <Link href={`/${language}/account/forgot-password`} className="font-semibold underline underline-offset-4">
            {t("askAgain")}
          </Link>
        </p>
      )}

      <button type="submit" disabled={busy || token === null} className={`mt-6 ${button}`}>
        {busy ? t("saving") : t("resetSubmit")}
      </button>
    </form>
  );
}
