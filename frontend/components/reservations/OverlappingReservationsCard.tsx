"use client";

import { useEffect, useState } from "react";
import { Sparkles, Users } from "lucide-react";

import { getOverlappingReservations, type OverlappingReservations } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDate, formatTime } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { t } from "@/lib/i18n";

const REASON_LABELS: Record<string, string> = {
  repeat_customer: "c.reservations.OverlappingReservationsCard.reasonRepeatCustomer",
  highest_value: "c.reservations.OverlappingReservationsCard.reasonHighestValue",
  requested_first: "c.reservations.OverlappingReservationsCard.reasonRequestedFirst",
};

/**
 * A PENDING reservation no longer blocks the car (see app/services/
 * availability.py), so staff reviewing one needs to see what else wants
 * the same slot before approving or rejecting it. Shown ambiently as soon
 * as the reservation loads, not only when clicking Approve.
 */
export function OverlappingReservationsCard({ reservationId }: { reservationId: string }) {
  const navigate = useNavigate();
  const [overlaps, setOverlaps] = useState<OverlappingReservations | null>(null);

  useEffect(() => {
    let cancelled = false;

    getOverlappingReservations(reservationId)
      .then((data) => {
        if (!cancelled) setOverlaps(data);
      })
      .catch(() => {
        // Non-fatal — the rest of the page still works without this.
      });

    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  if (!overlaps || overlaps.items.length === 0) {
    return null;
  }

  // The group being ranked is this reservation plus every other one
  // competing for the same car and dates — so the winner can be this very
  // reservation. When it is, none of the rows below should carry the
  // "Suggested" tag; say so directly instead of leaving it unexplained.
  const yourReservationIsSuggested = overlaps.suggested_id === reservationId;

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Users className="h-5 w-5 text-ink-muted" aria-hidden="true" />
        {t("c.reservations.OverlappingReservationsCard.title")}
      </h2>

      <p className="mt-1 text-sm text-ink-secondary">
        {t("c.reservations.OverlappingReservationsCard.body")}
      </p>

      {yourReservationIsSuggested && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-sm font-medium text-warning">
          <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t("c.reservations.OverlappingReservationsCard.yourReservationSuggested")}
          {overlaps.suggested_reasons.length > 0 && (
            <span className="font-normal text-border-strong">
              {" — "}
              {overlaps.suggested_reasons.map((reason) => t(REASON_LABELS[reason] ?? reason)).join(" · ")}
            </span>
          )}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {overlaps.items.map((item) => {
          const suggested = item.id === overlaps.suggested_id;

          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => navigate(`/reservations/manage/${item.id}`)}
                className="w-full rounded-lg border border-border-strong p-3 text-left transition hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                      {item.customer_name}
                      {suggested && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                          <Sparkles className="h-3 w-3" aria-hidden="true" />
                          {t("c.reservations.OverlappingReservationsCard.suggested")}
                        </span>
                      )}
                    </p>

                    <p className="mt-0.5 text-sm text-ink-secondary">
                      {formatDate(item.pickup_at)} {formatTime(item.pickup_at)} →{" "}
                      {formatDate(item.return_at)} {formatTime(item.return_at)}
                    </p>

                    {suggested && overlaps.suggested_reasons.length > 0 && (
                      <p className="mt-1 text-xs text-ink-muted">
                        {overlaps.suggested_reasons
                          .map((reason) => t(REASON_LABELS[reason] ?? reason))
                          .join(" · ")}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <ReservationStatusBadge status={item.status} />
                    {item.agreed_total_amount !== null && (
                      <p className="mt-1 text-sm font-medium text-ink">
                        {formatCurrency(item.agreed_total_amount)}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
