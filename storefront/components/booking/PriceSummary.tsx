"use client";

import { useTranslations } from "use-intl";

import type { PublicLocation } from "@shared/publicApi";

import type { Quote } from "@/lib/client";
import { formatDate, formatMoney, formatTime } from "@/lib/format";

type Vehicle = { make: string; model: string };

/** The booking so far: what, where, when, and the price with how it is paid. */
export function PriceSummary({
  language,
  vehicle,
  pickupAt,
  returnAt,
  pickupLocation,
  returnLocation,
  quote,
}: {
  language: string;
  vehicle: Vehicle;
  pickupAt: string;
  returnAt: string;
  pickupLocation: PublicLocation;
  returnLocation: PublicLocation;
  quote: Quote | null;
}) {
  const t = useTranslations("summary");
  const money = (amount: number) => formatMoney(amount, quote?.currency ?? "eur", language);
  const when = (iso: string, zone: string) =>
    t("dateAtTime", { date: formatDate(iso, zone, language), time: formatTime(iso, zone, language) });

  const includesVat = quote && quote.vat_rate > 0 && quote.prices_include_vat;
  const addsVat = quote && quote.vat_rate > 0 && !quote.prices_include_vat;
  const rate = quote ? `${Number(quote.vat_rate.toFixed(2))}` : "";

  return (
    <aside className="rounded-xl bg-surface p-5 shadow-sm lg:sticky lg:top-6">
      <h2 className="text-base font-semibold">{t("title")}</h2>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-ink-muted">{t("vehicle")}</dt>
          <dd className="font-medium">
            {vehicle.make} {vehicle.model}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("pickup")}</dt>
          <dd className="font-medium">{pickupLocation.airport_code}</dd>
          <dd className="text-ink-secondary">{when(pickupAt, pickupLocation.timezone)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("return")}</dt>
          <dd className="font-medium">{returnLocation.airport_code}</dd>
          <dd className="text-ink-secondary">{when(returnAt, returnLocation.timezone)}</dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-border-subtle pt-4">
        {!quote ? (
          <p className="text-sm text-ink-muted">{t("pricing")}</p>
        ) : (
          <>
            <dl className="space-y-2 text-sm">
              <Row label={t("rental", { days: quote.rental_days })} value={money(quote.base_amount)} />
              {quote.short_term_fee > 0 && <Row label={t("shortTermFee")} value={money(quote.short_term_fee)} />}
              {quote.airport_change_fee > 0 && <Row label={t("oneWayFee")} value={money(quote.airport_change_fee)} />}
              {quote.extras.map((line) => (
                <Row
                  key={line.code}
                  label={`${line.name}${line.quantity > 1 ? ` × ${line.quantity}` : ""}`}
                  value={money(line.amount)}
                />
              ))}
              {addsVat && (
                <>
                  <Row label={t("subtotal")} value={money(quote.net_amount)} />
                  <Row label={t("vat", { rate })} value={money(quote.vat_amount)} />
                </>
              )}
            </dl>

            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border-subtle pt-3">
              <span className="font-semibold">{t("total")}</span>
              <span className="text-lg font-bold tabular-nums">{money(quote.total_amount)}</span>
            </div>

            {includesVat && (
              <p className="mt-1 text-right text-xs text-ink-muted">{t("includesVat", { amount: money(quote.vat_amount) })}</p>
            )}

            <dl className="mt-4 space-y-2 rounded-lg bg-surface-sunken p-3 text-sm">
              <Row label={t("payNow", { percent: quote.online_share_percent })} value={money(quote.online_amount)} strong />
              <Row label={t("atPickup")} value={money(quote.due_at_pickup)} />
            </dl>

            <p className="mt-3 text-xs text-ink-muted">
              {t("freeCancel", {
                date: formatDate(quote.cancellation_deadline_at, pickupLocation.timezone, language),
                time: formatTime(quote.cancellation_deadline_at, pickupLocation.timezone, language),
              })}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>{value}</dd>
    </div>
  );
}
