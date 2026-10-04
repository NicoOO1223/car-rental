"use client";

import { useState } from "react";
import {
  ArrowRight,
  PlaneLanding,
  PlaneTakeoff,
  type LucideIcon,
} from "lucide-react";

import type { DashboardReservation } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  bookingReference,
  formatCurrency,
  formatDateShort,
  formatDuration,
  formatTime,
  instantToZoned,
  rentalDays,
  todayInZone,
} from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { t } from "@/lib/i18n";

type Direction = "pickup" | "return";

/** Whether the moment falls on today's date at the place it happens. */
function isToday(value: string, timeZone: string): boolean {
  return instantToZoned(value, timeZone).date === todayInZone(timeZone);
}

/**
 * One card, parameterized by direction, rather than two near-duplicate
 * blocks of JSX in the dashboard page — the pickups and returns cards
 * differ only in icon, copy, which timestamp they read, and where "View
 * all" goes.
 *
 * The pickup/landing icon pairing fits the business directly: this is an
 * airport car-rental operation (locations are named e.g. "Alghero
 * Fertilia Airport"), so a plane taking off or landing reads naturally as
 * a car going out or coming back.
 */
const DIRECTION_CONFIG: Record<
  Direction,
  {
    icon: LucideIcon;
    title: string;
    subtitle: string;
    timestampKey: "pickup_at" | "return_at";
    emptyTitle: string;
    emptyDescription: string;
    // Each row jumps straight into the next handover step: check-in for a
    // CONFIRMED reservation (payment, signatures, agreement), check-out for
    // a rental that is out with the customer.
    detailHref: (id: string) => string;
  }
> = {
  pickup: {
    icon: PlaneTakeoff,
    get title() { return t("c.dashboard.UpcomingCard.nextPickups"); },
    get subtitle() { return t("c.dashboard.UpcomingCard.pickupsSubtitle"); },
    timestampKey: "pickup_at",
    get emptyTitle() { return t("c.dashboard.UpcomingCard.noPickups"); },
    get emptyDescription() { return t("c.dashboard.UpcomingCard.noPickupsDescription"); },
    detailHref: (id) => `/handovers/${id}/check-in`,
  },
  return: {
    icon: PlaneLanding,
    get title() { return t("c.dashboard.UpcomingCard.nextReturns"); },
    get subtitle() { return t("c.dashboard.UpcomingCard.returnsSubtitle"); },
    timestampKey: "return_at",
    get emptyTitle() { return t("c.dashboard.UpcomingCard.noReturns"); },
    get emptyDescription() { return t("c.dashboard.UpcomingCard.noReturnsDescription"); },
    detailHref: (id) => `/handovers/${id}/check-out`,
  },
};

export function UpcomingCard({
  direction,
  reservations,
  viewAllHref,
}: {
  direction: Direction;
  reservations: DashboardReservation[];
  viewAllHref: string;
}) {
  const navigate = useNavigate();
  // A snapshot, so the "Overdue" chips don't change between renders.
  const [now] = useState(() => Date.now());
  const config = DIRECTION_CONFIG[direction];
  const Icon = config.icon;
  // The clock and the day shown are those of the place the event happens.
  const zoneOf = (reservation: DashboardReservation) =>
    direction === "pickup" ? reservation.pickup_timezone : reservation.return_timezone;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-ink">{config.title}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">{config.subtitle}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate(viewAllHref)}
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-ink-secondary transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 rounded-md"
        >{t("c.dashboard.UpcomingCard.viewAll")}<ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {reservations.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Icon}
          title={config.emptyTitle}
          description={config.emptyDescription}
        />
      ) : (
        <div className="mt-6 max-h-[360px] divide-y divide-border-subtle overflow-y-auto pr-1">
          {reservations.map((reservation) => (
            <button
              key={reservation.id}
              type="button"
              onClick={() => navigate(config.detailHref(reservation.id))}
              className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)_auto] items-start gap-4 py-3 text-left transition hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900"
            >
              {/* Left: the hour, and how long the rental lasts. */}
              <div className="self-center text-center">
                <p className="font-semibold text-ink">
                  {formatTime(reservation[config.timestampKey], zoneOf(reservation))}
                </p>

                {!isToday(reservation[config.timestampKey], zoneOf(reservation)) && (
                  <p className="text-xs text-ink-muted">
                    {formatDateShort(reservation[config.timestampKey], zoneOf(reservation))}
                  </p>
                )}

                <p className="mt-1 text-sm text-ink-muted">
                  {formatDuration(rentalDays(reservation.pickup_at, reservation.return_at, reservation.pickup_timezone))}
                </p>

                {direction === "return" &&
                  reservation.status === "ACTIVE" &&
                  new Date(reservation.return_at).getTime() < now && (
                    <span className="mt-1 inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{t("c.dashboard.UpcomingCard.overdue")}</span>
                  )}
              </div>

              {/* Middle: who, where, how to reach them. */}
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">
                  {reservation.customer_first_name} {reservation.customer_last_name}
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    {bookingReference(reservation.id)}
                  </span>
                </p>

                <p className="mt-1 truncate text-sm text-ink-muted">
                  {reservation.pickup_location_code}
                  <span aria-hidden="true"> → </span>
                  {reservation.return_location_code}
                </p>

                <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
                  <CountryFlag code={reservation.customer_nationality} />
                  {reservation.customer_phone_number && (
                    <span className="truncate">{reservation.customer_phone_number}</span>
                  )}
                </p>
              </div>

              {/* Right: the car and what it costs. */}
              <div className="text-right">
                <p className="font-medium text-ink">
                  {reservation.car_make} {reservation.car_model}
                </p>

                <p className="mt-1 text-sm text-ink-muted">
                  {reservation.car_license_plate}
                </p>

                <p className="mt-1 text-sm font-medium text-ink">
                  {formatCurrency(reservation.total_price)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
