"use client";

import { useState } from "react";
import { Banknote, CreditCard } from "lucide-react";
import { Elements } from "@stripe/react-stripe-js";

import {
  confirmCheckOutCashPayment,
  confirmCheckOutPayment,
} from "@/lib/api";
import { CashPaymentForm, PaymentForm } from "@/components/handover/PaymentStep";
import { formatCurrency } from "@/lib/format";
import { getStripePromise } from "@/lib/stripe";
import { t } from "@/lib/i18n";


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
      <p className="text-sm text-ink-secondary">{t("c.handover.CheckOutPaymentStep.amountDue")}{" "}<span className="font-semibold">
          {formatCurrency(amount, currency?.toUpperCase())}
        </span>
      </p>

      <div className="flex gap-2 border-b border-border-strong">
        {(
          [
            { key: "card", label: t("c.handover.CheckOutPaymentStep.card"), Icon: CreditCard },
            { key: "cash", label: t("c.handover.CheckOutPaymentStep.cash"), Icon: Banknote },
          ] as const
        ).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMethod(key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              method === key
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {method === "card" ? (
        getStripePromise() && clientSecret ? (
          <Elements
            key={clientSecret}
            stripe={getStripePromise()}
            options={{ clientSecret }}
          >
            <PaymentForm
              reservationId={reservationId}
              onPaid={onPaid}
              confirm={confirmCheckOutPayment}
            />
          </Elements>
        ) : (
          <div className="rounded-lg bg-surface-sunken p-4 text-sm text-ink-secondary">{t("c.handover.CheckOutPaymentStep.cardPaymentUnavailableRight")}</div>
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
