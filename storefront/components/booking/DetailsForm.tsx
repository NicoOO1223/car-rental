"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { Turnstile } from "@/components/Turnstile";
import { getCountries } from "@shared/countries";

export type Details = {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  email: string;
  phone_number: string;
  address: string;
  postal_code: string;
  nationality: string;
};

export const EMPTY_DETAILS: Details = {
  first_name: "",
  last_name: "",
  date_of_birth: "",
  email: "",
  phone_number: "",
  address: "",
  postal_code: "",
  nationality: "",
};

const input =
  "mt-1.5 w-full rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900";

/** Who is renting, the two consents, and the bot check. */
export function DetailsForm({
  language,
  holdMinutes,
  details,
  onChange,
  submitting,
  error,
  captchaReset,
  onSubmit,
}: {
  language: string;
  holdMinutes: number;
  details: Details;
  onChange: (details: Details) => void;
  submitting: boolean;
  error: string;
  captchaReset: number;
  onSubmit: (consent: { captchaToken: string }) => void;
}) {
  const t = useTranslations("details");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // A stack with no Turnstile key (development) passes with an empty token.
  const humanChecked = token !== null && (token !== "" || !hasSiteKey());

  const countries = useMemo(() => getCountries(language), [language]);

  const set =
    (key: keyof Details) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ ...details, [key]: event.target.value });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (terms && privacy && humanChecked) onSubmit({ captchaToken: token ?? "" });
  }

  const link = (path: string) => (chunks: React.ReactNode) => (
    <Link href={`/${language}/${path}`} target="_blank" className="font-medium underline">
      {chunks}
    </Link>
  );

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("intro")}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t("firstName")}
          <input className={input} value={details.first_name} onChange={set("first_name")} autoComplete="given-name" required maxLength={100} />
        </label>

        <label className="block text-sm font-medium">
          {t("lastName")}
          <input className={input} value={details.last_name} onChange={set("last_name")} autoComplete="family-name" required maxLength={100} />
        </label>

        <label className="block text-sm font-medium">
          {t("dateOfBirth")}
          <input className={input} type="date" value={details.date_of_birth} onChange={set("date_of_birth")} autoComplete="bday" required />
        </label>

        <label className="block text-sm font-medium">
          {t("phone")}
          <input className={input} type="tel" value={details.phone_number} onChange={set("phone_number")} autoComplete="tel" required minLength={3} maxLength={30} />
        </label>

        <label className="block text-sm font-medium sm:col-span-2">
          {t("email")}
          <input className={input} type="email" value={details.email} onChange={set("email")} autoComplete="email" required maxLength={254} />
          <span className="mt-1 block text-xs font-normal text-ink-muted">{t("emailHint")}</span>
        </label>

        <label className="block text-sm font-medium sm:col-span-2">
          {t("address")}
          <input className={input} value={details.address} onChange={set("address")} autoComplete="street-address" required maxLength={255} />
        </label>

        <label className="block text-sm font-medium">
          {t("postalCode")}
          <input className={input} value={details.postal_code} onChange={set("postal_code")} autoComplete="postal-code" required maxLength={20} />
        </label>

        <label className="block text-sm font-medium">
          {t("nationality")}
          <select className={input} value={details.nationality} onChange={set("nationality")} autoComplete="country">
            <option value="">—</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 space-y-3 border-t border-border-subtle pt-5 text-sm">
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} className="mt-0.5 h-4 w-4 accent-gray-900" />
          <span>{t.rich("acceptTerms", { link: link("terms") })}</span>
        </label>

        <label className="flex items-start gap-3">
          <input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} className="mt-0.5 h-4 w-4 accent-gray-900" />
          <span>{t.rich("acceptPrivacy", { link: link("privacy") })}</span>
        </label>
      </div>

      <div className="mt-5">
        <Turnstile onToken={setToken} resetKey={captchaReset} language={language} />
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <p className="mt-5 text-xs text-ink-muted">{t("holdNote", { minutes: holdMinutes })}</p>

      <button
        type="submit"
        disabled={submitting || !terms || !privacy || !humanChecked}
        className="mt-3 w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {submitting ? t("submitting") : t("submit")}
      </button>

      {(!terms || !privacy) && <p className="mt-2 text-center text-xs text-ink-muted">{t("needTerms")}</p>}
    </form>
  );
}

function hasSiteKey(): boolean {
  return Boolean(window.__RUNTIME_CONFIG__?.turnstileSiteKey);
}
