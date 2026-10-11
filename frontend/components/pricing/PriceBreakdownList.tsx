import { formatCurrency, formatDuration } from "@/lib/format";
import type { PriceBreakdown } from "@/lib/api";
import { extraName } from "@/lib/extras";
import { t } from "@/lib/i18n";

/**
 * The itemized price, rendered identically in the booking wizard and on
 * the counter's payment screen.
 *
 * Both used to print the same three line-item labels from separate hand
 * written markup, one with a euro prefix and one with a trailing currency
 * code. They now share this, and they share the server-computed breakdown
 * behind it, so the number a customer is quoted and the number the counter
 * charges cannot drift.
 */
export function PriceBreakdownList({
  breakdown,
  totalLabel = t("c.pricing.PriceBreakdownList.total"),
  className = "",
}: {
  breakdown: Pick<
    PriceBreakdown,
    | "base_amount"
    | "short_term_fee"
    | "airport_change_fee"
    | "extras"
    | "total_amount"
  > &
    Partial<
      Pick<
        PriceBreakdown,
        "vat_rate" | "vat_amount" | "net_amount" | "prices_include_vat" | "adjustment_amount"
      >
    > & { rental_days?: number; currency?: string };
  totalLabel?: string;
  className?: string;
}) {
  const currency = breakdown.currency?.toUpperCase();
  const money = (amount: number) => formatCurrency(amount, currency);

  // With a VAT rate set, the tax is shown: added on top when prices exclude
  // it, and as the part of the total that is tax when they include it.
  const vatRate = breakdown.vat_rate ?? 0;
  const vatAmount = breakdown.vat_amount ?? 0;
  const addsVat = vatRate > 0 && breakdown.prices_include_vat === false;
  const includesVat = vatRate > 0 && breakdown.prices_include_vat !== false;
  const rateLabel = `${Number(vatRate.toFixed(2))}%`;

  return (
    <div className={className}>
      <dl className="space-y-2.5 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-secondary">{t("c.pricing.PriceBreakdownList.baseRental")}{breakdown.rental_days ? (
              <span className="text-ink-muted">
                {" "}
                · {formatDuration(breakdown.rental_days)}
              </span>
            ) : null}
          </dt>
          <dd className="shrink-0 font-medium text-ink tabular-nums">
            {money(breakdown.base_amount)}
          </dd>
        </div>

        {breakdown.short_term_fee > 0 && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-secondary">{t("c.pricing.PriceBreakdownList.shortTermRentalFee")}</dt>
            <dd className="shrink-0 font-medium text-ink tabular-nums">
              {money(breakdown.short_term_fee)}
            </dd>
          </div>
        )}

        {breakdown.airport_change_fee > 0 && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-secondary">{t("c.pricing.PriceBreakdownList.airportChangeFee")}</dt>
            <dd className="shrink-0 font-medium text-ink tabular-nums">
              {money(breakdown.airport_change_fee)}
            </dd>
          </div>
        )}

        {breakdown.extras.map((line) => (
          <div
            key={line.code}
            className="flex items-baseline justify-between gap-4"
          >
            <dt className="text-ink-secondary">
              {extraName(line)}
              {line.quantity > 1 && (
                <span className="text-ink-muted"> × {line.quantity}</span>
              )}
            </dt>
            <dd className="shrink-0 font-medium text-ink tabular-nums">
              {money(line.amount)}
            </dd>
          </div>
        ))}

        {breakdown.adjustment_amount ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-secondary">{t("c.pricing.PriceBreakdownList.adjustment")}</dt>
            <dd className="shrink-0 font-medium text-ink tabular-nums">
              {money(breakdown.adjustment_amount)}
            </dd>
          </div>
        ) : null}
      </dl>

      {addsVat && (
        <dl className="mt-4 space-y-2.5 border-t border-border-subtle pt-4 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-secondary">{t("c.pricing.PriceBreakdownList.subtotal")}</dt>
            <dd className="shrink-0 font-medium text-ink tabular-nums">
              {money(breakdown.net_amount ?? breakdown.total_amount - vatAmount)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-secondary">{t("c.pricing.PriceBreakdownList.vat", { rateLabel })}</dt>
            <dd className="shrink-0 font-medium text-ink tabular-nums">
              {money(vatAmount)}
            </dd>
          </div>
        </dl>
      )}

      <div
        className={`flex items-baseline justify-between gap-4 border-t border-border-subtle pt-4 ${
          addsVat ? "mt-3" : "mt-4"
        }`}
      >
        <span className="font-semibold text-ink">{totalLabel}</span>
        <span className="text-xl font-bold text-ink tabular-nums">
          {money(breakdown.total_amount)}
        </span>
      </div>

      {includesVat && (
        <p className="mt-2 text-right text-xs text-ink-muted">{t("c.pricing.PriceBreakdownList.includesVat", { rate: rateLabel, amount: money(vatAmount) })}</p>
      )}
    </div>
  );
}
