"use client";

import { ArrowRight, PlaneLanding, PlaneTakeoff, type LucideIcon } from "lucide-react";

import type { DashboardReservation } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { TwoLine } from "@/components/ui/DataTable";
import { formatDateTime } from "@/lib/format";
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
  }
> = {
  pickup: {
    icon: PlaneTakeoff,
    title: "Next pickups",
    subtitle: "Vehicles going out soon",
    timestampKey: "pickup_at",
    emptyTitle: "No upcoming pickups",
    emptyDescription: "There are no future pickups scheduled.",
  },
  return: {
    icon: PlaneLanding,
    title: "Next returns",
    subtitle: "Vehicles due back soon",
    timestampKey: "return_at",
    emptyTitle: "No upcoming returns",
    emptyDescription: "There are no vehicles due back.",
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
              onClick={() => navigate(`/reservations/manage/${reservation.id}`)}
              className="flex w-full flex-col gap-3 py-3 text-left transition hover:bg-surface-sunken md:flex-row md:items-center md:justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900"
            >
              <TwoLine
                primary={`${reservation.customer_first_name} ${reservation.customer_last_name}`}
                secondary={`${reservation.car_make} ${reservation.car_model} · ${reservation.car_license_plate}`}
              />

              <div className="md:text-right">
                <p className="font-medium text-ink">
                  {formatDateTime(reservation[config.timestampKey])}
                </p>

                <p className="mt-1 text-sm text-ink-muted">
                  {reservation.pickup_location_code}
                  <span aria-hidden="true"> → </span>
                  {reservation.return_location_code}
                </p>
              </div>

              <ReservationStatusBadge
                status={reservation.status}
                className="self-start md:self-auto"
              />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
