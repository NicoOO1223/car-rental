"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

import { confirmHandoverPayment } from "@/lib/api";
import { Button } from "@/components/ui/Button";

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

  const currencyLabel = currency?.toUpperCase() ?? "";

  return (
    <div className="space-y-4">
      {amount !== null && (
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Base rental</span>
            <span>{baseAmount.toFixed(2)} {currencyLabel}</span>
          </div>

          {shortTermFee > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Short-term rental fee</span>
              <span>{shortTermFee.toFixed(2)} {currencyLabel}</span>
            </div>
          )}

          {airportChangeFee > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Airport change fee</span>
              <span>{airportChangeFee.toFixed(2)} {currencyLabel}</span>
            </div>
          )}

          <div className="flex justify-between border-t pt-1.5 font-semibold text-gray-900">
            <span>Amount due</span>
            <span>{amount.toFixed(2)} {currencyLabel}</span>
          </div>
        </div>
      )}

      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <PaymentForm reservationId={reservationId} onPaid={onPaid} />
      </Elements>
    </div>
  );
}
