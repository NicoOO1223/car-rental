"use client";

import { useEffect, useState } from "react";
import { Banknote, CreditCard } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";

import {
  confirmCashDeposit,
  confirmDepositHold,
  createDepositIntent,
} from "@/lib/api";
import { CashPaymentForm, PaymentForm } from "@/components/handover/PaymentStep";
import { formatCurrency } from "@/lib/format";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

type Props = {
  reservationId: string;
  amount: number;
  currency: string | null;
  onHeld: () => void;
};

/**
 * Takes the security deposit at check-in: a card authorization (the
 * customer's card is reserved, not charged) or cash.
 */
export function DepositStep({ reservationId, amount, currency, onHeld }: Props) {
  const [method, setMethod] = useState<"card" | "cash">("card");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (method !== "card") return;

    let cancelled = false;

    async function start() {
      try {
        const intent = await createDepositIntent(reservationId);

        if (!cancelled) {
          setClientSecret(intent.client_secret);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setClientSecret(null);
          setError(err instanceof Error ? err.message : "Failed to start the deposit.");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
    };
  }, [method, reservationId]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        Deposit:{" "}
        <span className="font-semibold">
          {formatCurrency(amount, currency?.toUpperCase())}
        </span>
        . Any return charges are taken from it at check-out and the rest is
        released or handed back.
      </p>

      <div className="flex gap-2 border-b border-border-strong">
        {(
          [
            { key: "card", label: "Card hold", Icon: CreditCard },
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
        <div className="space-y-3">
          {error && (
            <p className="rounded-lg bg-gray-100 p-3 text-sm text-gray-700">
              {error} A card hold may be unavailable, but you can still take
              cash.
            </p>
          )}

          {stripePromise && clientSecret ? (
            <>
              <p className="text-xs text-ink-muted">
                The card is authorized for this amount but not charged. Long
                rentals may outlast the hold; use cash for those.
              </p>

              <Elements
                key={clientSecret}
                stripe={stripePromise}
                options={{ clientSecret }}
              >
                <PaymentForm
                  reservationId={reservationId}
                  onPaid={onHeld}
                  confirm={confirmDepositHold}
                  submitLabel="Hold deposit on card"
                />
              </Elements>
            </>
          ) : (
            !error && <p className="text-sm text-ink-muted">Preparing the card hold…</p>
          )}
        </div>
      ) : (
        <CashPaymentForm
          reservationId={reservationId}
          onPaid={onHeld}
          confirm={confirmCashDeposit}
          description="Confirm only once the deposit has been received in cash. It is handed back at check-out, less any charges."
          buttonLabel="Confirm Cash Deposit"
        />
      )}
    </div>
  );
}
