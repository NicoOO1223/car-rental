"use client";

import { useState } from "react";
import { Banknote, CircleCheck, CreditCard } from "lucide-react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

import {
  confirmCashPayment,
  confirmHandoverPayment,
  settlePrepaidHandover,
  type PriceBreakdownExtraLine,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { PriceBreakdownList } from "@/components/pricing/PriceBreakdownList";
import { formatCurrency } from "@/lib/format";
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
  /** A manual change to the price by staff, signed; 0 when none. */
  adjustmentAmount?: number;
  /** VAT on the amount due, so it is shown as it was in the quote. */
  vat?: { rate: number; amount: number; net: number; includedInPrices: boolean };
  /** What the renter already paid on the website; the amount above is what is left. */
  paidOnline?: number;
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
        <p className="text-sm text-danger">{error}</p>
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
      <p className="text-sm text-ink-secondary">{description}</p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button onClick={handleConfirm} disabled={confirming} fullWidth>
        <Banknote className="h-4 w-4" aria-hidden="true" />
        {confirming ? t("c.handover.PaymentStep.confirming") : buttonLabel}
      </Button>
    </div>
  );
}

/**
 * A rental paid in full on the website: nothing to take at the counter, only
 * to record that so check-in can go on.
 */
export function PrepaidSettleForm({
  reservationId,
  paidOnline,
  currency,
  onPaid,
}: Pick<Props, "reservationId" | "onPaid"> & { paidOnline: number; currency: string }) {
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState("");

  async function handleSettle() {
    setSettling(true);
    setError("");

    try {
      await settlePrepaidHandover(reservationId);
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.handover.PaymentStep.failedSettle"));
    } finally {
      setSettling(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-ink-secondary">
        <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("c.handover.PaymentStep.paidInFullOnline", {
          amount: formatCurrency(paidOnline, currency.toUpperCase()),
        })}
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button onClick={handleSettle} loading={settling} fullWidth>
        {t("c.handover.PaymentStep.continueNothingDue")}
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
  adjustmentAmount,
  vat,
  paidOnline = 0,
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
            adjustment_amount: adjustmentAmount,
            // With an online share, the lines add up to the whole price and the
            // part still to pay is shown under them.
            total_amount: amount + paidOnline,
            currency: currency ?? undefined,
            vat_rate: vat?.rate,
            vat_amount: vat?.amount,
            net_amount: vat?.net,
            prices_include_vat: vat?.includedInPrices,
          }}
          totalLabel={
            paidOnline > 0 ? t("c.handover.PaymentStep.total") : t("c.handover.PaymentStep.amountDue")
          }
        />
      )}

      {amount !== null && paidOnline > 0 && (
        <dl className="space-y-2.5 rounded-lg bg-canvas p-4 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-secondary">{t("c.handover.PaymentStep.paidOnline")}</dt>
            <dd className="font-medium text-ink tabular-nums">
              −{formatCurrency(paidOnline, currency?.toUpperCase())}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle pt-2.5">
            <dt className="font-semibold text-ink">{t("c.handover.PaymentStep.dueNow")}</dt>
            <dd className="text-lg font-bold text-ink tabular-nums">
              {formatCurrency(amount, currency?.toUpperCase())}
            </dd>
          </div>
        </dl>
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
        getStripePromise() ? (
          <Elements stripe={getStripePromise()} options={{ clientSecret }}>
            <PaymentForm reservationId={reservationId} onPaid={onPaid} />
          </Elements>
        ) : (
          <div className="rounded-lg bg-surface-sunken p-4 text-sm text-ink-secondary">{t("c.handover.PaymentStep.stripeNotConfigured")}</div>
        )
      ) : (
        <CashPaymentForm reservationId={reservationId} onPaid={onPaid} />
      )}
    </div>
  );
}
