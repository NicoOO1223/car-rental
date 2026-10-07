"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { cancelReservation, type Reservation } from "@/lib/api";
import { can } from "@/lib/permissions";
import { formatCurrency, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Cancelling a booking whose renter paid a share online: staff choose whether
 * to give it back. The choice starts on what the admin's policy says for this
 * moment (refund up to the cancellation deadline, keep after it), and staff
 * can go against it for this one booking.
 */
export function CancelWithRefundModal({
  reservation,
  onClose,
  onCancelled,
}: {
  reservation: Reservation;
  onClose: () => void;
  onCancelled: (updated: Reservation) => void;
}) {
  const deadline = reservation.cancellation_deadline_at;
  const withinPolicy = deadline === null || new Date() <= new Date(deadline);

  const { user } = useCurrentUser();
  // Deciding against the policy is a manager's call. Anyone else cancels and the
  // policy applies: refunded up to the deadline, kept after it.
  const canDecide = can(user?.role, "money.approve");

  const [refund, setRefund] = useState(withinPolicy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const payment = reservation.prepayment;
  const amount = formatCurrency(Number(payment?.amount ?? 0), payment?.currency ?? undefined);
  const zone = reservation.pickup_location.timezone;

  async function handleConfirm() {
    setSaving(true);
    setError("");

    try {
      onCancelled(await cancelReservation(reservation.id, canDecide ? { refundPrepayment: refund } : {}));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.reservations.CancelWithRefundModal.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t("c.reservations.CancelWithRefundModal.title")}
      description={
        deadline
          ? withinPolicy
            ? t("c.reservations.CancelWithRefundModal.withinPolicy", {
                date: formatDate(deadline, zone),
                time: formatTime(deadline, zone),
              })
            : t("c.reservations.CancelWithRefundModal.afterPolicy", {
                date: formatDate(deadline, zone),
                time: formatTime(deadline, zone),
              })
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("c.reservations.CancelWithRefundModal.keepBooking")}
          </Button>
          <Button variant="danger" onClick={handleConfirm} loading={saving}>
            {t("c.reservations.CancelWithRefundModal.cancelBooking")}
          </Button>
        </>
      }
    >
      {!canDecide && (
        <p className="text-sm text-ink-secondary">
          {withinPolicy
            ? t("c.reservations.CancelWithRefundModal.policyRefunds", { amount })
            : t("c.reservations.CancelWithRefundModal.policyKeeps", { amount })}{" "}
          {t("c.reservations.CancelWithRefundModal.managerDecides")}
        </p>
      )}

      <fieldset className={canDecide ? "space-y-3" : "hidden"}>
        <legend className="mb-2 text-sm text-ink-secondary">
          {t("c.reservations.CancelWithRefundModal.question", { amount })}
        </legend>

        {[
          { value: true, label: t("c.reservations.CancelWithRefundModal.refund", { amount }) },
          { value: false, label: t("c.reservations.CancelWithRefundModal.keep", { amount }) },
        ].map((option) => (
          <label
            key={String(option.value)}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border-strong p-3 text-sm has-[:checked]:border-accent"
          >
            <input
              type="radio"
              name="refund"
              checked={refund === option.value}
              onChange={() => setRefund(option.value)}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-ink">{option.label}</span>
          </label>
        ))}
      </fieldset>

      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
