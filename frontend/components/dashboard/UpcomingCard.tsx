"use client";

import {
  ArrowRight,
  Phone,
  PlaneLanding,
  PlaneTakeoff,
  type LucideIcon,
} from "lucide-react";

import type { DashboardReservation } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { countryFlagEmoji, countryName } from "@/lib/countries";
import { formatCurrency, formatDateShort, formatTime } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";

type Direction = "pickup" | "return";

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
    // Pickup rows jump straight into the handover flow (payment,
    // signature, agreement) since that's the very next action for a
    // CONFIRMED reservation. Returns don't have an equivalent
    // "finalize" screen — completing a return happens from the
    // reservation detail page instead, so that's where those rows go.
    detailHref: (id: string) => string;
  }
> = {
  pickup: {
    icon: PlaneTakeoff,
    title: "Next pickups",
    subtitle: "Vehicles going out soon",
    timestampKey: "pickup_at",
    emptyTitle: "No upcoming pickups",
    emptyDescription: "There are no future pickups scheduled.",
    detailHref: (id) => `/reservations/finalize/${id}`,
  },
  return: {
    icon: PlaneLanding,
    title: "Next returns",
    subtitle: "Vehicles due back soon",
    timestampKey: "return_at",
    emptyTitle: "No upcoming returns",
    emptyDescription: "There are no vehicles due back.",
    detailHref: (id) => `/reservations/manage/${id}`,
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
  const config = DIRECTION_CONFIG[direction];
  const Icon = config.icon;

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
        >
          View all
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
              className="flex w-full flex-col gap-3 py-3 text-left transition hover:bg-surface-sunken md:flex-row md:items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900"
            >
              <div className="min-w-0 md:flex-1">
                <p className="truncate font-medium text-ink">
                  {countryFlagEmoji(reservation.customer_nationality) && (
                    <span
                      className="mr-1.5"
                      title={countryName(reservation.customer_nationality)}
                    >
                      {countryFlagEmoji(reservation.customer_nationality)}
                    </span>
                  )}
                  {reservation.customer_first_name} {reservation.customer_last_name}
                </p>

                {reservation.customer_phone_number && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
                    <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{reservation.customer_phone_number}</span>
                  </p>
                )}

                <p className="mt-1 truncate text-sm text-ink-muted">
                  {reservation.car_make} {reservation.car_model}
                  <span aria-hidden="true"> · </span>
                  {reservation.car_license_plate}
                </p>

                <p className="mt-1 text-sm font-medium text-ink">
                  {formatCurrency(reservation.total_price)}
                </p>
              </div>

              <div className="shrink-0 md:w-36 md:text-right">
                <p className="font-medium text-ink">
                  {formatDateShort(reservation[config.timestampKey])},{" "}
                  {formatTime(reservation[config.timestampKey])}
                </p>

                <p className="mt-1 text-sm text-ink-muted">
                  {reservation.pickup_location_code}
                  <span aria-hidden="true"> → </span>
                  {reservation.return_location_code}
                </p>
              </div>

              <ReservationStatusBadge
                status={reservation.status}
                className="shrink-0 self-start md:self-auto"
              />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
