"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import { formatMoney } from "@/lib/format";
import { getStripePromise } from "@/lib/stripe";

/** Counts down to a moment, once a second, as m:ss. Calls onEnd when it passes. */
function Countdown({ until, onEnd }: { until: string; onEnd: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(until).getTime() - Date.now()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, new Date(until).getTime() - Date.now());

      setLeft(remaining);

      if (remaining === 0) {
        window.clearInterval(timer);
        onEnd();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [until, onEnd]);

  const total = Math.ceil(left / 1000);

  return (
    <span className="font-mono tabular-nums">
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")}
    </span>
  );
}

function PayForm({
  language,
  reference,
  amountLabel,
}: {
  language: string;
  reference: string;
  amountLabel: string;
}) {
  const t = useTranslations("pay");
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!stripe || !elements) return;

    setSubmitting(true);
    setError("");

    const target = `/${language}/book/return?reference=${encodeURIComponent(reference)}`;

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}${target}` },
      // A card payment finishes here; only a method that leaves the site
      // (a bank redirect) comes back through the return address.
      redirect: "if_required",
    });

    if (stripeError) {
      // The provider's own wording is already in a language it chose.
      setError(stripeError.message || t("failed"));
      setSubmitting(false);
      return;
    }

    router.push(target);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* A plain card form: renters have no account, and Link would ask them to
          create one (with a mobile number) in the middle of paying. */}
      <PaymentElement options={{ wallets: { link: "never" } }} />

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {submitting ? t("processing") : t("button", { amount: amountLabel })}
      </button>
    </form>
  );
}

/** The card form for a held booking, with the time left to pay. */
export function PaymentPanel({
  language,
  reference,
  clientSecret,
  holdExpiresAt,
  onlineAmount,
  dueAtPickup,
  currency,
  onExpired,
}: {
  language: string;
  reference: string;
  clientSecret: string;
  holdExpiresAt: string;
  onlineAmount: number;
  dueAtPickup: number;
  currency: string;
  onExpired: () => void;
}) {
  const t = useTranslations("pay");
  const stripePromise = getStripePromise();
  const money = (amount: number) => formatMoney(amount, currency, language);

  return (
    <section className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold">{t("title", { amount: money(onlineAmount) })}</h2>

      <p className="mt-1 text-sm text-ink-secondary">
        {t("timeLeft")}: <Countdown until={holdExpiresAt} onEnd={onExpired} />
      </p>

      {dueAtPickup > 0 && <p className="mt-1 text-sm text-ink-secondary">{t("remainder", { amount: money(dueAtPickup) })}</p>}

      <div className="mt-4 rounded-lg bg-surface-sunken p-3 text-sm">
        <p className="text-ink-muted">{t("reference")}</p>
        <p className="font-mono text-base font-semibold tracking-wide">{reference}</p>
        <p className="mt-1 text-xs text-ink-muted">{t("referenceHint")}</p>
      </div>

      <div className="mt-5">
        {stripePromise ? (
          <Elements stripe={stripePromise} options={{ clientSecret, locale: language as "en" | "it" | "pl" }}>
            <PayForm language={language} reference={reference} amountLabel={money(onlineAmount)} />
          </Elements>
        ) : (
          <p className="rounded-lg bg-surface-sunken p-4 text-sm text-ink-secondary">{t("notConfigured")}</p>
        )}
      </div>
    </section>
  );
}
