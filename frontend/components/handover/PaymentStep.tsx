"use client";

import { useState } from "react";
import { Banknote, CreditCard } from "lucide-react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

import {
  confirmCashPayment,
  confirmHandoverPayment,
  type PriceBreakdownExtraLine,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { PriceBreakdownList } from "@/components/pricing/PriceBreakdownList";
import { getStripePromise } from "@/lib/stripe";
import { t } from "@/lib/i18n";


type Props = {
  reservationId: string;
  clientSecret: string;
  amount: number | null;
  currency: string | null;
  baseAmount: number;
  shortTermFee: number;
  airportChangeFee: number;
  extras: PriceBreakdownExtraLine[];
  extrasAmount: number;
  /** VAT on the amount due, so it is shown as it was in the quote. */
  vat?: { rate: number; amount: number; net: number; includedInPrices: boolean };
  onPaid: () => void;
};

type ConfirmFn = (reservationId: string) => Promise<unknown>;

// `confirm` defaults to the check-in payment; the check-out flow passes its
// own.
export function PaymentForm({
  reservationId,
  onPaid,
  confirm = confirmHandoverPayment,
  submitLabel = t("c.handover.PaymentStep.chargeCard"),
}: Pick<Props, "reservationId" | "onPaid"> & {
  confirm?: ConfirmFn;
  submitLabel?: string;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });

      if (stripeError) {
        throw new Error(stripeError.message || t("c.handover.PaymentStep.paymentFailed"));
      }

      // Never trust the client-side result alone — the server re-verifies
      // the PaymentIntent directly against Stripe before we advance.
      await confirm(reservationId);

      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.handover.PaymentStep.paymentFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <Button type="submit" disabled={!stripe || submitting} fullWidth>
        <CreditCard className="h-4 w-4" aria-hidden="true" />
        {submitting ? t("c.handover.PaymentStep.processing") : submitLabel}
      </Button>
    </form>
  );
}

export function CashPaymentForm({
  reservationId,
  onPaid,
  confirm = confirmCashPayment,
  description = t("c.handover.PaymentStep.confirmOnlyOnceFull"),
  buttonLabel = t("c.handover.PaymentStep.confirmCashPayment"),
}: Pick<Props, "reservationId" | "onPaid"> & {
  confirm?: ConfirmFn;
  description?: string;
  buttonLabel?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setConfirming(true);
    setError("");

    try {
      await confirm(reservationId);
      onPaid();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("c.handover.PaymentStep.failedConfirmCashPayment"),
      );
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">{description}</p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button onClick={handleConfirm} disabled={confirming} fullWidth>
        <Banknote className="h-4 w-4" aria-hidden="true" />
        {confirming ? t("c.handover.PaymentStep.confirming") : buttonLabel}
      </Button>
    </div>
  );
}

export function PaymentStep({
  reservationId,
  clientSecret,
  amount,
  currency,
  baseAmount,
  shortTermFee,
  airportChangeFee,
  extras,
  vat,
  onPaid,
}: Props) {
  const [method, setMethod] = useState<"card" | "cash">("card");

  return (
    <div className="space-y-4">
      {amount !== null && (
        // The same component the booking wizard renders, fed the same
        // server-computed breakdown, so the quoted price and the charged
        // price cannot present differently.
        <PriceBreakdownList
          breakdown={{
            base_amount: baseAmount,
            short_term_fee: shortTermFee,
            airport_change_fee: airportChangeFee,
            extras,
            total_amount: amount,
            currency: currency ?? undefined,
            vat_rate: vat?.rate,
            vat_amount: vat?.amount,
            net_amount: vat?.net,
            prices_include_vat: vat?.includedInPrices,
          }}
          totalLabel={t("c.handover.PaymentStep.amountDue")}
        />
      )}

      <div className="flex gap-2 border-b border-border-strong">
        {(
          [
            { key: "card", label: t("c.handover.PaymentStep.card"), Icon: CreditCard },
            { key: "cash", label: t("c.handover.PaymentStep.cash"), Icon: Banknote },
          ] as const
        ).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMethod(key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              method === key
                ? "border-gray-900 text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {method === "card" ? (
        getStripePromise() ? (
          <Elements stripe={getStripePromise()} options={{ clientSecret }}>
            <PaymentForm reservationId={reservationId} onPaid={onPaid} />
          </Elements>
        ) : (
          <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700">{t("c.handover.PaymentStep.stripeNotConfigured")}</div>
        )
      ) : (
        <CashPaymentForm reservationId={reservationId} onPaid={onPaid} />
      )}
    </div>
  );
}
