"use client";

import { useState } from "react";
import { Banknote, CreditCard } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";

import {
  confirmCheckOutCashPayment,
  confirmCheckOutPayment,
} from "@/lib/api";
import { CashPaymentForm, PaymentForm } from "@/components/handover/PaymentStep";
import { formatCurrency } from "@/lib/format";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

type Props = {
  reservationId: string;
  clientSecret: string | null;
  amount: number;
  currency: string | null;
  onPaid: () => void;
};

/** Card or cash payment of the check-out charges. */
export function CheckOutPaymentStep({
  reservationId,
  clientSecret,
  amount,
  currency,
  onPaid,
}: Props) {
  const [method, setMethod] = useState<"card" | "cash">("card");

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        Amount due:{" "}
        <span className="font-semibold">
          {formatCurrency(amount, currency?.toUpperCase())}
        </span>
      </p>

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
        stripePromise && clientSecret ? (
          <Elements
            key={clientSecret}
            stripe={stripePromise}
            options={{ clientSecret }}
          >
            <PaymentForm
              reservationId={reservationId}
              onPaid={onPaid}
              confirm={confirmCheckOutPayment}
            />
          </Elements>
        ) : (
          <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700">
            Card payment is unavailable right now — you can still take cash.
          </div>
        )
      ) : (
        <CashPaymentForm
          reservationId={reservationId}
          onPaid={onPaid}
          confirm={confirmCheckOutCashPayment}
        />
      )}
    </div>
  );
}
