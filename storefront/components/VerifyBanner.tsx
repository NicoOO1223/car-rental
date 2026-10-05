"use client";

import { useState } from "react";
import { useTranslations } from "use-intl";

import { accountApi } from "@/lib/account";
import { errorMessage } from "@/lib/errors";

/** Shown on an account whose address is not confirmed yet: what to do, and a way to get the email again. */
export function VerifyBanner({ email }: { email: string }) {
  const t = useTranslations("accountMail");
  const all = useTranslations();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function resend() {
    setBusy(true);
    setError("");

    try {
      await accountApi.resendVerification();
      setSent(true);
    } catch (failure) {
      setError(errorMessage(all, failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950" role="status">
      <p className="font-semibold">{t("bannerTitle")}</p>
      <p className="mt-1">{t("bannerBody", { email })}</p>

      <button
        type="button"
        onClick={resend}
        disabled={busy || sent}
        className="mt-3 rounded-lg border border-amber-400 bg-white px-3 py-2 font-medium hover:bg-amber-100 disabled:opacity-50"
      >
        {sent ? t("bannerSent") : t("bannerResend")}
      </button>

      {error && (
        <p className="mt-2 text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
