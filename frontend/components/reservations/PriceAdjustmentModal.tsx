"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { getPublicConfiguration, setPriceAdjustment, type Reservation } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";

type Props = {
  reservation: Reservation;
  /** Counter staff have to say why; a manager or admin need not. */
  reasonRequired: boolean;
  onClose: () => void;
  onSaved: (updated: Reservation) => void;
};

const cents = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/** Two decimals at most, in either field. */
const fits = (value: string) => !/[.,]\d{3,}/.test(value);

/**
 * Changes what one reservation costs, before anything has been paid: one card for
 * everybody. Type a discount in percent or the new total you want; the two follow
 * each other, to the cent. It is stored as an adjustment line of its own, so the
 * invoice and agreement still add up.
 */
export function PriceAdjustmentModal({ reservation, reasonRequired, onClose, onSaved }: Props) {
  const current = Number(reservation.agreed_total_amount ?? 0);
  const currentAdjustment = Number(reservation.price_adjustment_amount ?? 0);

  const [reason, setReason] = useState(reservation.price_adjustment_reason ?? "");
  const [vat, setVat] = useState<{ rate: number; includes: boolean }>({ rate: 0, includes: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getPublicConfiguration()
      .then((configuration) => {
        if (!cancelled) setVat({ rate: configuration.vat_rate, includes: configuration.prices_include_vat });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  // An adjustment is on the same basis as the other lines: net when VAT is added on top.
  const factor = vat.includes ? 1 : 1 + vat.rate / 100;

  // The discount is measured against the price before any adjustment, so reopening
  // the card shows the same percentage that was set.
  const base = current - currentAdjustment * factor;

  const [discount, setDiscount] = useState(
    currentAdjustment && base > 0 ? cents((1 - current / base) * 100) : "",
  );
  const [total, setTotal] = useState(cents(current));

  function changeDiscount(value: string) {
    if (!fits(value)) return;

    setDiscount(value);

    const typed = Number(value);

    setTotal(value.trim() !== "" && Number.isFinite(typed) ? cents(base * (1 - typed / 100)) : cents(current));
  }

  function changeTotal(value: string) {
    if (!fits(value)) return;

    setTotal(value);

    const typed = Number(value);

    if (value.trim() !== "" && Number.isFinite(typed) && base > 0) {
      setDiscount(cents((1 - typed / base) * 100));
    }
  }

  const newTotal = Number(total);
  const valid = total.trim() !== "" && Number.isFinite(newTotal) && newTotal >= 0;
  // What is stored is the money difference, on the same basis as the other lines.
  const adjustment = valid ? Math.round(((newTotal - base) / factor) * 100) / 100 : currentAdjustment;
  const changed = valid && Math.abs(adjustment - currentAdjustment) >= 0.005;
  const reasonMissing = reasonRequired && reason.trim().length < 3;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const updated = await setPriceAdjustment(reservation.id, adjustment.toFixed(2), reason.trim());

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.reservations.PriceAdjustmentModal.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.reservations.PriceAdjustmentModal.title")}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("c.reservations.PriceAdjustmentModal.cancel")}
          </Button>
          <Button type="submit" form="price-adjustment-form" disabled={saving || !changed || reasonMissing}>
            {saving ? t("c.reservations.PriceAdjustmentModal.saving") : t("c.reservations.PriceAdjustmentModal.save")}
          </Button>
        </>
      }
    >
      <form id="price-adjustment-form" onSubmit={handleSubmit} className="space-y-5">
        <p className="text-sm text-ink-secondary">{t("c.reservations.PriceAdjustmentModal.intro")}</p>

        <dl className="flex items-baseline justify-between gap-4 rounded-lg bg-surface-sunken p-3 text-sm">
          <dt className="text-ink-secondary">{t("c.reservations.PriceAdjustmentModal.currentTotal")}</dt>
          <dd className="font-medium tabular-nums">{formatCurrency(current)}</dd>
        </dl>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("c.reservations.PriceAdjustmentModal.discount")}>
            {(props) => (
              <Input
                {...props}
                type="number"
                step="0.01"
                max={100}
                value={discount}
                disabled={base <= 0}
                onChange={(event) => changeDiscount(event.target.value)}
                placeholder="10.00"
              />
            )}
          </Field>

          <Field label={t("c.reservations.PriceAdjustmentModal.newTotal")}>
            {(props) => (
              <Input
                {...props}
                type="number"
                step="0.01"
                min={0}
                value={total}
                onChange={(event) => changeTotal(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label={t("c.reservations.PriceAdjustmentModal.reason")}
          hint={
            reasonRequired
              ? t("c.reservations.PriceAdjustmentModal.reasonHint")
              : t("c.reservations.PriceAdjustmentModal.reasonHintOptional")
          }
          required={reasonRequired}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              maxLength={300}
              className="h-auto py-2"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>

        {valid && changed && (
          <p className="text-sm text-ink-secondary">
            {t("c.reservations.PriceAdjustmentModal.willBecome", { amount: formatCurrency(newTotal) })}
          </p>
        )}

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
