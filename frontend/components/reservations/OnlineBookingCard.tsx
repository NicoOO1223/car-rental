import { Globe } from "lucide-react";

import { Card } from "@/components/ui/Card";
import type { Reservation } from "@/lib/api";
import { formatCurrency, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * A booking's reference, what the renter was asked to pay in advance and what was
 * paid, and until when cancelling gives that back. Shown for a booking made on
 * the website and for one staff approved with an advance; nothing for a plain
 * staff booking.
 */
export function OnlineBookingCard({ reservation }: { reservation: Reservation }) {
  if (reservation.source !== "STOREFRONT" && reservation.advance_amount === null && reservation.prepayment === null) {
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

  // Approved, with the advance still to come. While it is awaited the actions panel
  // already says how much and by when, so it is not repeated here.
  const awaitingAdvance = reservation.status === "AWAITING_PAYMENT" && reservation.advance_amount !== null;

  if (!payment && reservation.advance_amount !== null && !awaitingAdvance) {
    rows.push({
      label: t("c.reservations.OnlineBookingCard.advanceAsked"),
      value: money(reservation.advance_amount),
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

  if (reservation.status === "AWAITING_PAYMENT" && reservation.hold_expires_at && !awaitingAdvance) {
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
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Globe className="h-5 w-5 text-ink-muted" aria-hidden="true" />
        {reservation.source === "STOREFRONT"
          ? t("c.reservations.OnlineBookingCard.bookedOnline")
          : t("c.reservations.OnlineBookingCard.advancePayment")}
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
