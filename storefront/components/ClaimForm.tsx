"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { accountApi } from "@/lib/account";
import { errorMessage } from "@/lib/errors";

const input =
  "mt-1.5 w-full rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900";

/** Adds a booking made earlier (as a guest) to the signed-in account. */
export function ClaimForm() {
  const t = useTranslations("account");
  const all = useTranslations();
  const router = useRouter();

  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setDone(false);

    try {
      await accountApi.claim({ reference: reference.trim(), email: email.trim() });
      setDone(true);
      setReference("");
      setEmail("");
      router.refresh();
    } catch (failure) {
      setError(errorMessage(all, failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{t("claimTitle")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("claimIntro")}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t("reference")}
          <input
            className={`${input} font-mono uppercase`}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={20}
            required
          />
        </label>

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
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {done && (
        <p className="mt-4 text-sm font-medium text-green-700" role="status">
          {t("claimed")}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 rounded-xl bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {busy ? t("claiming") : t("claimSubmit")}
      </button>
    </form>
  );
}
