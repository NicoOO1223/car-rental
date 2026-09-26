"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, RefreshCw } from "lucide-react";

import {
  getReservations,
  getReservationSummary,
  type Reservation,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { SubNav } from "@/components/ui/SubNav";
import { formatDate, formatTime } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { useUrlFilters } from "@/lib/useUrlFilters";

const FILTER_DEFAULTS = {
  tab: "check-in",
};

type Tab = "check-in" | "check-out";

const QUEUE_LIMIT = 100;

/** "Late by 3h 20m" for an ACTIVE rental past its scheduled return. */
function lateLabel(returnAt: string, now: number): string | null {
  const minutes = Math.floor((now - new Date(returnAt).getTime()) / 60_000);

  if (minutes <= 0) return null;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours >= 24) return `Late by ${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `Late by ${hours}h ${rest}m`;

  return `Late by ${rest}m`;
}

export default function HandoversPage() {
  const navigate = useNavigate();
  const { filters, setFilters } = useUrlFilters(FILTER_DEFAULTS);
  const tab: Tab = filters.tab === "check-out" ? "check-out" : "check-in";

  // The two work queues, fetched by status. The server caps a page at
  // QUEUE_LIMIT rows, far more than a counter can work through; if a queue
  // ever exceeds it, the page says so rather than silently hiding rows.
  const [awaitingCheckIn, setAwaitingCheckIn] = useState<Reservation[]>([]);
  const [awaitingCheckOut, setAwaitingCheckOut] = useState<Reservation[]>([]);
  const [checkInTotal, setCheckInTotal] = useState(0);
  const [checkOutTotal, setCheckOutTotal] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // A snapshot rather than Date.now() during render, so the "late by"
  // labels don't change under the table between renders.
  const [now, setNow] = useState(() => Date.now());

  const loadQueues = useCallback(async () => {
    const [checkIn, checkOut, summary] = await Promise.all([
      getReservations({
        status: "CONFIRMED",
        sort: "pickup_asc",
        limit: QUEUE_LIMIT,
      }),
      getReservations({
        status: "ACTIVE",
        sort: "return_asc",
        limit: QUEUE_LIMIT,
      }),
      getReservationSummary(),
    ]);

    setAwaitingCheckIn(checkIn.items);
    setCheckInTotal(checkIn.total);
    setAwaitingCheckOut(checkOut.items);
    setCheckOutTotal(checkOut.total);
    setOverdueCount(summary.overdue_returns);
    setNow(Date.now());
  }, []);

  async function refreshReservations() {
    setRefreshing(true);
    setError("");

    try {
      await loadQueues();
    } catch {
      setError("Failed to load reservations.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        await loadQueues();
      } catch {
        setError("Failed to load reservations.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [loadQueues]);

  const customerColumn: Column<Reservation> = {
    id: "customer",
    header: "Customer",
    mobile: "primary",
    cell: (reservation) =>
      `${reservation.customer.first_name} ${reservation.customer.last_name}`,
    sortable: true,
    sortAccessor: (reservation) =>
      `${reservation.customer.last_name} ${reservation.customer.first_name}`,
  };

  const vehicleColumn: Column<Reservation> = {
    id: "vehicle",
    header: "Vehicle",
    mobile: "secondary",
    cell: (reservation) => (
      <TwoLine
        primary={`${reservation.car.make} ${reservation.car.model}`}
        secondary={reservation.car.license_plate}
      />
    ),
    mobileCell: (reservation) =>
      `${reservation.car.make} ${reservation.car.model} · ${reservation.car.license_plate}`,
    sortable: true,
    sortAccessor: (reservation) =>
      `${reservation.car.make} ${reservation.car.model}`,
  };

  const pickupColumn: Column<Reservation> = {
    id: "pickup",
    header: "Pickup",
    mobileLabel: "Pickup",
    cell: (reservation) => (
      <TwoLine
        primary={formatDate(reservation.pickup_at, reservation.pickup_location.timezone)}
        secondary={formatTime(reservation.pickup_at, reservation.pickup_location.timezone)}
      />
    ),
    mobileCell: (reservation) =>
      `${formatDate(reservation.pickup_at, reservation.pickup_location.timezone)}, ${formatTime(reservation.pickup_at, reservation.pickup_location.timezone)}`,
    sortable: true,
    sortAccessor: (reservation) => new Date(reservation.pickup_at),
  };

  const returnColumn: Column<Reservation> = {
    id: "return",
    header: "Return",
    mobileLabel: "Return",
    cell: (reservation) => (
      <TwoLine
        primary={formatDate(reservation.return_at, reservation.return_location.timezone)}
        secondary={formatTime(reservation.return_at, reservation.return_location.timezone)}
      />
    ),
    mobileCell: (reservation) =>
      `${formatDate(reservation.return_at, reservation.return_location.timezone)}, ${formatTime(reservation.return_at, reservation.return_location.timezone)}`,
    sortable: true,
    sortAccessor: (reservation) => new Date(reservation.return_at),
  };

  const bookedColumn: Column<Reservation> = {
    id: "booked",
    header: "Booked",
    mobileLabel: "Booked",
    cell: (reservation) => (
      <TwoLine
        primary={formatDate(reservation.created_at)}
        secondary={formatTime(reservation.created_at)}
      />
    ),
    mobileCell: (reservation) =>
      `${formatDate(reservation.created_at)}, ${formatTime(reservation.created_at)}`,
    sortable: true,
    sortAccessor: (reservation) => new Date(reservation.created_at),
  };

  const routeColumn: Column<Reservation> = {
    id: "route",
    header: "Route",
    mobileLabel: "Route",
    cell: (reservation) => (
      <span className="text-sm font-medium text-ink">
        {reservation.pickup_location.airport_code}
        <span className="mx-2 text-ink-muted" aria-hidden="true">
          →
        </span>
        {reservation.return_location.airport_code}
      </span>
    ),
  };

  const lateColumn: Column<Reservation> = {
    id: "late",
    header: "Status",
    mobileLabel: "Status",
    cell: (reservation) => {
      const late = lateLabel(reservation.return_at, now);

      return late ? (
        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          {late}
        </span>
      ) : (
        <span className="text-sm text-ink-muted">On time</span>
      );
    },
    mobileCell: (reservation) =>
      lateLabel(reservation.return_at, now) ?? "On time",
    sortable: true,
    sortAccessor: (reservation) => new Date(reservation.return_at),
  };

  const columns: Column<Reservation>[] =
    tab === "check-in"
      ? [customerColumn, vehicleColumn, pickupColumn, returnColumn, bookedColumn, routeColumn]
      : [customerColumn, vehicleColumn, returnColumn, lateColumn, pickupColumn, routeColumn];

  const rows = tab === "check-in" ? awaitingCheckIn : awaitingCheckOut;

  function openHandover(reservation: Reservation) {
    navigate(
      tab === "check-in"
        ? `/handovers/${reservation.id}/check-in`
        : `/handovers/${reservation.id}/check-out`,
    );
  }

  if (error) {
    return (
      <PageShell width="wide">
        <div className="rounded-xl bg-surface p-8 shadow-sm">
          <p className="text-red-600" role="alert">
            {error}
          </p>

          <Button className="mt-4" onClick={refreshReservations}>
            Try again
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title="Handovers"
        description="Check vehicles in when the customer arrives and out when they bring them back."
        actions={
          <Button
            variant="secondary"
            onClick={refreshReservations}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      <StatTileGrid columns={3} className="mb-6">
        <StatTile
          label="Awaiting check-in"
          value={checkInTotal}
          icon={ArrowLeftRight}
        />
        <StatTile
          label="Awaiting check-out"
          value={checkOutTotal}
          icon={ArrowLeftRight}
        />
        <StatTile
          label="Overdue returns"
          value={overdueCount}
          icon={ArrowLeftRight}
        />
      </StatTileGrid>

      <SubNav
        className="mb-4"
        activeId={tab}
        onSelect={(id) => setFilters({ tab: id })}
        items={[
          { id: "check-in", label: "Check-in", count: checkInTotal },
          { id: "check-out", label: "Check-out", count: checkOutTotal },
        ]}
      />

      {(tab === "check-in" ? checkInTotal : checkOutTotal) > QUEUE_LIMIT && (
        <p className="mb-3 text-sm text-ink-muted">
          Showing the first {QUEUE_LIMIT} of{" "}
          {tab === "check-in" ? checkInTotal : checkOutTotal}. Work through
          these and refresh to see the rest.
        </p>
      )}

      <DataTable
        key={tab}
        rows={rows}
        columns={columns}
        rowKey={(reservation) => reservation.id}
        loading={loading}
        defaultSort={{
          columnId: tab === "check-in" ? "pickup" : "return",
          direction: "asc",
        }}
        onRowClick={openHandover}
        rowActions={[
          {
            label: tab === "check-in" ? "Start check-in" : "Start check-out",
            onClick: openHandover,
          },
        ]}
        empty={{
          icon: ArrowLeftRight,
          title:
            tab === "check-in"
              ? "Nothing waiting for check-in"
              : "Nothing waiting for check-out",
          description:
            tab === "check-in"
              ? "Confirmed reservations show up here once they are approved."
              : "Vehicles out with customers show up here until they are checked back in.",
        }}
      />
    </PageShell>
  );
}
