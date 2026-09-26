import { Globe } from "lucide-react";

import { Card } from "@/components/ui/Card";
import type { Reservation } from "@/lib/api";
import { formatCurrency, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * What only a booking made on the public website has: its reference, what the
 * renter paid online, and until when cancelling gives that back. Nothing is
 * shown for a booking made by staff.
 */
export function OnlineBookingCard({ reservation }: { reservation: Reservation }) {
  if (reservation.source !== "STOREFRONT") {
    return null;
  }

  const zone = reservation.pickup_location.timezone;
  const payment = reservation.prepayment;
  const currency = payment?.currency ?? undefined;
  const money = (value: string | number) => formatCurrency(Number(value), currency);
  const at = (value: string) =>
    t("common.dateAtTime", { date: formatDate(value, zone), time: formatTime(value, zone) });

  const paid = payment?.payment_status === "SUCCEEDED";
  const refunded = payment?.payment_status === "REFUNDED";
  const cancelled = reservation.status === "CANCELLED";

  const rows: { label: string; value: string }[] = [
    { label: t("c.reservations.OnlineBookingCard.reference"), value: reservation.public_reference ?? "" },
  ];

  if (reservation.prepayment_percent !== null && reservation.agreed_total_amount !== null) {
    rows.push({
      label: t("c.reservations.OnlineBookingCard.agreedPrice"),
      value: t("c.reservations.OnlineBookingCard.priceWithShare", {
        total: money(reservation.agreed_total_amount),
        percent: reservation.prepayment_percent,
      }),
    });
  }

  if (payment && payment.amount !== null) {
    rows.push({
      label: t("c.reservations.OnlineBookingCard.paidOnline"),
      value: refunded
        ? t("c.reservations.OnlineBookingCard.refundedAmount", { amount: money(payment.amount) })
        : paid && cancelled
          ? t("c.reservations.OnlineBookingCard.keptAmount", { amount: money(payment.amount) })
          : paid
            ? money(payment.amount)
            : t("c.reservations.OnlineBookingCard.notPaid", { amount: money(payment.amount) }),
    });
  }

  if (reservation.status === "AWAITING_PAYMENT" && reservation.hold_expires_at) {
    rows.push({
      label: t("c.reservations.OnlineBookingCard.holdUntil"),
      value: at(reservation.hold_expires_at),
    });
  }

  if (reservation.cancellation_deadline_at && !cancelled) {
    rows.push({
      label: t("c.reservations.OnlineBookingCard.refundableUntil"),
      value: at(reservation.cancellation_deadline_at),
    });
  }

  if (cancelled && reservation.cancellation_reason) {
    rows.push({
      label: t("c.reservations.OnlineBookingCard.cancelledBy"),
      value: t("c.reservations.OnlineBookingCard.reason", { reason: reservation.cancellation_reason }),
    });
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Globe className="h-5 w-5 text-ink-muted" aria-hidden="true" />
        {t("c.reservations.OnlineBookingCard.bookedOnline")}
      </h2>

      <dl className="mt-4 space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-secondary">{row.label}</dt>
            <dd className="text-right font-medium text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
