"use client";

import { createElement } from "react";
import {
  Baby,
  Droplets,
  HeartPulse,
  Minus,
  Plus,
  ShieldCheck,
  Sofa,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { formatCurrency } from "@/lib/format";
import type { Extra, ExtraSelection } from "@/lib/api";
import { extraDescription, extraName } from "@/lib/extras";
import { t } from "@/lib/i18n";

/**
 * Icons per catalog code. Falls back to a generic shield so an extra
 * added to the catalog later still renders sensibly without a code change.
 */
const EXTRA_ICONS: Record<string, LucideIcon> = {
  ADDITIONAL_DRIVER: UserPlus,
  REFUELING_SERVICE: Droplets,
  PASSENGER_INSURANCE: HeartPulse,
  INTERIOR_COVERAGE: Sofa,
  BABY_SEAT: Baby,
  CHILD_SEAT: Baby,
};

function priceLabel(extra: Extra): string {
  const price = formatCurrency(extra.price);

  return extra.price_unit === "PER_DAY"
    ? t("c.booking.ExtrasPicker.perDay", { price })
    : `${price} one-off`;
}

export function ExtrasPicker({
  extras,
  selections,
  onChange,
}: {
  extras: Extra[];
  selections: ExtraSelection[];
  onChange: (next: ExtraSelection[]) => void;
}) {
  const quantityOf = (extraId: string) =>
    selections.find((item) => item.extra_id === extraId)?.quantity ?? 0;

  function setQuantity(extraId: string, quantity: number) {
    if (quantity <= 0) {
      onChange(selections.filter((item) => item.extra_id !== extraId));
      return;
    }

    const existing = selections.find((item) => item.extra_id === extraId);

    if (existing) {
      onChange(
        selections.map((item) =>
          item.extra_id === extraId ? { ...item, quantity } : item,
        ),
      );
      return;
    }

    onChange([...selections, { extra_id: extraId, quantity }]);
  }

  return (
    <ul className="space-y-3">
      {extras.map((extra) => {
        const quantity = quantityOf(extra.id);
        const isSelected = quantity > 0;
        const countable = extra.max_quantity > 1;
        const icon = EXTRA_ICONS[extra.code] ?? ShieldCheck;

        return (
          <li
            key={extra.id}
            className={`rounded-xl bg-surface p-4 shadow-sm transition ${
              isSelected
                ? "ring-2 ring-gray-900"
                : "ring-1 ring-transparent hover:ring-border-strong"
            }`}
          >
            <div className="flex items-start gap-4">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition ${
                  isSelected
                    ? "bg-gray-900 text-white"
                    : "bg-surface-sunken text-ink-muted"
                }`}
              >
                {createElement(icon, {
                  className: "h-5 w-5",
                  "aria-hidden": true,
                })}
              </span>

              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{extraName(extra)}</p>

                {extraDescription(extra) && (
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {extraDescription(extra)}
                  </p>
                )}

                <p className="mt-1.5 text-sm font-medium text-ink">
                  {priceLabel(extra)}
                </p>
              </div>

              <div className="shrink-0">
                {countable && isSelected ? (
                  <div className="flex items-center gap-1 rounded-lg border border-border-strong p-1">
                    <button
                      type="button"
                      onClick={() => setQuantity(extra.id, quantity - 1)}
                      aria-label={t("c.booking.ExtrasPicker.removeOne", { name: extraName(extra) })}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                    >
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </button>

                    <span
                      aria-live="polite"
                      className="w-6 text-center text-sm font-semibold tabular-nums text-ink"
                    >
                      {quantity}
                    </span>

                    <button
                      type="button"
                      disabled={quantity >= extra.max_quantity}
                      onClick={() => setQuantity(extra.id, quantity + 1)}
                      aria-label={t("c.booking.ExtrasPicker.addOneMore", { name: extraName(extra) })}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setQuantity(extra.id, isSelected ? 0 : 1)}
                    aria-pressed={isSelected}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 ${
                      isSelected
                        ? "bg-surface-sunken text-ink"
                        : "border border-border-strong bg-white text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                    }`}
                  >
                    {isSelected ? t("c.booking.ExtrasPicker.added") : t("c.booking.ExtrasPicker.add")}
                  </button>
                )}

                {countable && !isSelected && (
                  <p className="mt-1 text-center text-xs text-ink-muted">{t("c.booking.ExtrasPicker.up", { max_quantity: extra.max_quantity })}</p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
