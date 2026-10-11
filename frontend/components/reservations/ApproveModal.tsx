"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { approveReservation, getPublicConfiguration, type Reservation } from "@/lib/api";
import { formatCurrency, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";

type Choice = "request" | "none";

/**
 * Approving a request: ask the renter for the advance (the car is held until they
 * pay it, or until staff record it by hand), or confirm it without one. With no
 * advance due there is nothing to choose and the booking is simply confirmed.
 */
export function ApproveModal({
  reservation,
  onClose,
  onApproved,
}: {
  reservation: Reservation;
  onClose: () => void;
  onApproved: (updated: Reservation) => void;
}) {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getPublicConfiguration>> | null>(null);
  // When an advance asked for now would have to be paid by, worked out once the settings are known.
  const [windowEnd, setWindowEnd] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>("request");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getPublicConfiguration()
      .then((value) => {
        if (cancelled) return;

        setConfig(value);
        setWindowEnd(
          new Date(
            Math.min(
              Date.now() + value.payment_window_hours * 3_600_000,
              new Date(reservation.pickup_at).getTime() - 3_600_000,
            ),
          ).toISOString(),
        );
      })
      .catch(() => {
        if (!cancelled) setError(t("c.reservations.ApproveModal.failedLoad"));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = Number(reservation.agreed_total_amount ?? 0);
  const percent = config?.online_share_percent ?? 0;
  // The same arithmetic as the server's split: the share, never below 0.50, never above the total.
  const advance = percent > 0 && total > 0 ? Math.min(Math.max(Math.round(total * percent) / 100, 0.5), total) : 0;
  const dueAdvance = advance > 0;

  const zone = reservation.pickup_location.timezone;

  async function approve() {
    setSaving(true);
    setError("");

    try {
      onApproved(await approveReservation(reservation.id, dueAdvance ? choice : "none"));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.reservations.ApproveModal.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.reservations.ApproveModal.title")}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("c.reservations.ApproveModal.cancel")}
          </Button>
          <Button type="button" onClick={approve} disabled={saving || !config}>
            {saving ? t("c.reservations.ApproveModal.approving") : t("c.reservations.ApproveModal.approve")}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {!config ? (
          <p className="text-ink-secondary">{t("c.reservations.ApproveModal.loading")}</p>
        ) : !dueAdvance ? (
          <p className="text-ink-secondary">
            {percent === 0
              ? t("c.reservations.ApproveModal.noAdvanceZero")
              : t("c.reservations.ApproveModal.noAdvanceTotal")}
          </p>
        ) : (
          <fieldset className="space-y-3">
            <legend className="mb-2 font-medium text-ink">
              {t("c.reservations.ApproveModal.advanceDue", { amount: formatCurrency(advance), percent })}
            </legend>

            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border-strong p-3">
              <input
                type="radio"
                name="advance"
                className="mt-0.5 h-4 w-4 accent-accent"
                checked={choice === "request"}
                onChange={() => setChoice("request")}
              />
              <span>
                <span className="font-medium text-ink">{t("c.reservations.ApproveModal.ask")}</span>
                <span className="block text-ink-secondary">
                  {windowEnd
                    ? t("c.reservations.ApproveModal.askBody", {
                        date: formatDate(windowEnd, zone),
                        time: formatTime(windowEnd, zone),
                      })
                    : ""}
                </span>
                {!config.online_advance_available && (
                  <span className="mt-1 block text-warning">{t("c.reservations.ApproveModal.noOnlinePayment")}</span>
                )}
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border-strong p-3">
              <input
                type="radio"
                name="advance"
                className="mt-0.5 h-4 w-4 accent-accent"
                checked={choice === "none"}
                onChange={() => setChoice("none")}
              />
              <span>
                <span className="font-medium text-ink">{t("c.reservations.ApproveModal.waive")}</span>
                <span className="block text-ink-secondary">{t("c.reservations.ApproveModal.waiveBody")}</span>
              </span>
            </label>
          </fieldset>
        )}

        {error && (
          <p className="text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
