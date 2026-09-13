"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

import {
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
  onPaid: () => void;
};

function PaymentForm({
  reservationId,
  onPaid,
}: Pick<Props, "reservationId" | "onPaid">) {
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
      await confirmHandoverPayment(reservationId);

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
        {submitting ? "Processing payment..." : "Charge Card"}
      </Button>
    </form>
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
  onPaid,
}: Props) {
  if (!stripePromise) {
    return (
      <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700">
        Stripe is not configured yet — set{" "}
        <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> in{" "}
        <code>frontend/.env.local</code> to enable payment.
      </div>
    );
  }

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
            currency: currency ?? "eur",
          }}
          totalLabel="Amount due"
        />
      )}

      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <PaymentForm reservationId={reservationId} onPaid={onPaid} />
      </Elements>
    </div>
  );
}
