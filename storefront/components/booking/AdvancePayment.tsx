"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { PaymentPanel } from "@/components/booking/PaymentPanel";
import { api, type Booking } from "@/lib/client";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatMoney, formatTime } from "@/lib/format";

/**
 * Staff approved the booking and asked for an advance. The renter reads what is
 * due and by when, accepts the terms if they never did (staff made the booking
 * for them), and pays with the same card form the booking wizard uses.
 */
export function AdvancePayment({ language, booking, token }: { language: string; booking: Booking; token: string }) {
  const t = useTranslations("advance");
  const all = useTranslations();

  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const amount = booking.advance_amount ?? 0;
  const money = (value: number) => formatMoney(value, booking.currency, language);
  const zone = booking.pickup_location.timezone;
  const deadline = booking.hold_expires_at;
  const needsTerms = !booking.terms_accepted;
  const ready = !needsTerms || (terms && privacy);

  async function start() {
    setBusy(true);
    setError("");

    try {
      const started = await api.startPayment(booking.reference, token, {
        terms_accepted: terms,
        privacy_acknowledged: privacy,
      });

      setSecret(started.client_secret);
    } catch (failure) {
      setError(errorMessage(all, failure));
    } finally {
      setBusy(false);
    }
  }

  if (secret && deadline) {
    return (
      <PaymentPanel
        language={language}
        reference={booking.reference}
        clientSecret={secret}
        holdExpiresAt={deadline}
        onlineAmount={amount}
        dueAtPickup={Math.max(booking.total_amount - amount, 0)}
        currency={booking.currency}
        onExpired={() => window.location.reload()}
      />
    );
  }

  const link = (path: string) => (chunks: React.ReactNode) => (
    <Link href={`/${language}/${path}`} target="_blank" className="font-medium underline">
      {chunks}
    </Link>
  );

  return (
    <section className="rounded-xl border-2 border-accent bg-surface p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold">{t("title", { amount: money(amount) })}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("body")}</p>

      {deadline && (
        <p className="mt-3 text-sm font-medium">
          {t("deadline", { date: formatDate(deadline, zone, language), time: formatTime(deadline, zone, language) })}
        </p>
      )}

      {booking.total_amount > amount && (
        <p className="mt-1 text-sm text-ink-secondary">{t("remainder", { amount: money(booking.total_amount - amount) })}</p>
      )}

      {needsTerms && (
        <div className="mt-4 space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} className="mt-0.5 h-4 w-4 accent-gray-900" />
            <span>{t.rich("acceptTerms", { link: link("terms") })}</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} className="mt-0.5 h-4 w-4 accent-gray-900" />
            <span>{t.rich("acceptPrivacy", { link: link("privacy") })}</span>
          </label>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={start}
        disabled={busy || !ready}
        className="mt-5 w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto"
      >
        {busy ? t("preparing") : t("pay", { amount: money(amount) })}
      </button>
    </section>
  );
}
