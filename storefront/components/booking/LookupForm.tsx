"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { Turnstile } from "@/components/Turnstile";
import { api } from "@/lib/client";
import { errorMessage } from "@/lib/errors";
import { manageToken } from "@/lib/session";

const input =
  "mt-1.5 w-full rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900";

/** Finds a booking from its reference and the booker email. */
export function LookupForm({ language }: { language: string }) {
  const t = useTranslations("lookup");
  const all = useTranslations();
  const router = useRouter();

  const [reference, setReference] = useState(useSearchParams().get("reference") ?? "");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  const humanChecked = token !== null && (token !== "" || !window.__RUNTIME_CONFIG__?.turnstileSiteKey);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSearching(true);
    setError("");

    try {
      const found = await api.lookup({ reference, email, captcha_token: token ?? "" });

      manageToken.set(found.booking.reference, found.manage_token);
      router.push(`/${language}/booking/${encodeURIComponent(found.booking.reference)}`);
    } catch (failure) {
      setError(errorMessage(all, failure));
      setResetKey((count) => count + 1);
      setSearching(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-ink-secondary">{t("intro")}</p>

      <div className="mt-5 space-y-4">
        <label className="block text-sm font-medium">
          {t("reference")}
          <input
            className={`${input} font-mono uppercase`}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder={t("referencePlaceholder")}
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

        <Turnstile onToken={setToken} resetKey={resetKey} language={language} />
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={searching || !humanChecked}
        className="mt-5 w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {searching ? t("searching") : t("submit")}
      </button>
    </form>
  );
}
