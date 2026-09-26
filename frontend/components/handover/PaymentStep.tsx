"use client";

import { useState } from "react";
import { Banknote, CreditCard } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
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

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

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
  submitLabel = "Charge Card",
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
        throw new Error(stripeError.message || "Payment failed.");
      }

      // Never trust the client-side result alone — the server re-verifies
      // the PaymentIntent directly against Stripe before we advance.
      await confirm(reservationId);

      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed.");
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
        {submitting ? "Processing..." : submitLabel}
      </Button>
    </form>
  );
}

export function CashPaymentForm({
  reservationId,
  onPaid,
  confirm = confirmCashPayment,
  description = "Confirm only once the full amount has been received in cash from the customer.",
  buttonLabel = "Confirm Cash Payment",
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
        err instanceof Error ? err.message : "Failed to confirm cash payment.",
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
        {confirming ? "Confirming..." : buttonLabel}
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
          totalLabel="Amount due"
        />
      )}

      <div className="flex gap-2 border-b border-border-strong">
        {(
          [
            { key: "card", label: "Card", Icon: CreditCard },
            { key: "cash", label: "Cash", Icon: Banknote },
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
        stripePromise ? (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <PaymentForm reservationId={reservationId} onPaid={onPaid} />
          </Elements>
        ) : (
          <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700">
            Stripe is not configured yet — set{" "}
            <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> in{" "}
            <code>frontend/.env.local</code> to enable card payment.
          </div>
        )
      ) : (
        <CashPaymentForm reservationId={reservationId} onPaid={onPaid} />
      )}
    </div>
  );
}
