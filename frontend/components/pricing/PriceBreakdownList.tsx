import { formatCurrency, formatDuration } from "@/lib/format";
import type { PriceBreakdown } from "@/lib/api";

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
  totalLabel = "Total",
  className = "",
}: {
  breakdown: Pick<
    PriceBreakdown,
    | "base_amount"
    | "short_term_fee"
    | "airport_change_fee"
    | "extras"
    | "total_amount"
  > & { rental_days?: number; currency?: string };
  totalLabel?: string;
  className?: string;
}) {
  const currency = breakdown.currency?.toUpperCase();
  const money = (amount: number) => formatCurrency(amount, currency);

  return (
    <div className={className}>
      <dl className="space-y-2.5 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-secondary">
            Base rental
            {breakdown.rental_days ? (
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
            <dt className="text-ink-secondary">Short-term rental fee</dt>
            <dd className="shrink-0 font-medium text-ink tabular-nums">
              {money(breakdown.short_term_fee)}
            </dd>
          </div>
        )}

        {breakdown.airport_change_fee > 0 && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-secondary">Airport change fee</dt>
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
              {line.name}
              {line.quantity > 1 && (
                <span className="text-ink-muted"> × {line.quantity}</span>
              )}
            </dt>
            <dd className="shrink-0 font-medium text-ink tabular-nums">
              {money(line.amount)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-border-subtle pt-4">
        <span className="font-semibold text-ink">{totalLabel}</span>
        <span className="text-xl font-bold text-ink tabular-nums">
          {money(breakdown.total_amount)}
        </span>
      </div>
    </div>
  );
}
