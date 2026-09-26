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
import { t } from "@/lib/i18n";

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

  if (hours >= 24) return t("s.handovers.lateByDH", { v1: Math.floor(hours / 24), v2: hours % 24 });
  if (hours > 0) return t("s.handovers.lateByHM", { hours, rest });

  return t("s.handovers.lateByM", { rest });
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
      setError(t("s.handovers.failedLoadReservations"));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        await loadQueues();
      } catch {
        setError(t("s.handovers.failedLoadReservations"));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [loadQueues]);

  const customerColumn: Column<Reservation> = {
    id: "customer",
    header: t("s.handovers.customer"),
    mobile: "primary",
    cell: (reservation) =>
      `${reservation.customer.first_name} ${reservation.customer.last_name}`,
    sortable: true,
    sortAccessor: (reservation) =>
      `${reservation.customer.last_name} ${reservation.customer.first_name}`,
  };

  const vehicleColumn: Column<Reservation> = {
    id: "vehicle",
    header: t("s.handovers.vehicle"),
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
    header: t("s.handovers.pickup"),
    mobileLabel: t("s.handovers.pickup"),
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
    header: t("s.handovers.return"),
    mobileLabel: t("s.handovers.return"),
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
    header: t("s.handovers.booked"),
    mobileLabel: t("s.handovers.booked"),
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
    header: t("s.handovers.route"),
    mobileLabel: t("s.handovers.route"),
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
    header: t("s.handovers.status"),
    mobileLabel: t("s.handovers.status"),
    cell: (reservation) => {
      const late = lateLabel(reservation.return_at, now);

      return late ? (
        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          {late}
        </span>
      ) : (
        <span className="text-sm text-ink-muted">{t("s.handovers.time")}</span>
      );
    },
    mobileCell: (reservation) =>
      lateLabel(reservation.return_at, now) ?? t("s.handovers.time"),
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

          <Button className="mt-4" onClick={refreshReservations}>{t("s.handovers.tryAgain")}</Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title={t("s.handovers.handovers")}
        description={t("s.handovers.checkVehiclesWhenCustomer")}
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
            {refreshing ? t("s.handovers.refreshing") : t("s.handovers.refresh")}
          </Button>
        }
      />

      <StatTileGrid columns={3} className="mb-6">
        <StatTile
          label={t("s.handovers.awaitingCheck")}
          value={checkInTotal}
          icon={ArrowLeftRight}
        />
        <StatTile
          label={t("s.handovers.awaitingCheckOut")}
          value={checkOutTotal}
          icon={ArrowLeftRight}
        />
        <StatTile
          label={t("s.handovers.overdueReturns")}
          value={overdueCount}
          icon={ArrowLeftRight}
        />
      </StatTileGrid>

      <SubNav
        className="mb-4"
        activeId={tab}
        onSelect={(id) => setFilters({ tab: id })}
        items={[
          { id: "check-in", label: t("s.handovers.check"), count: checkInTotal },
          { id: "check-out", label: t("s.handovers.checkOut"), count: checkOutTotal },
        ]}
      />

      {(tab === "check-in" ? checkInTotal : checkOutTotal) > QUEUE_LIMIT && (
        <p className="mb-3 text-sm text-ink-muted">{t("s.handovers.showingFirstWorkThrough", { limit: QUEUE_LIMIT, total: tab === "check-in" ? checkInTotal : checkOutTotal })}</p>
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
            label: tab === "check-in" ? t("s.handovers.startCheck") : t("s.handovers.startCheckOut"),
            onClick: openHandover,
          },
        ]}
        empty={{
          icon: ArrowLeftRight,
          title:
            tab === "check-in"
              ? t("s.handovers.nothingWaitingCheck")
              : t("s.handovers.nothingWaitingCheckOut"),
          description:
            tab === "check-in"
              ? t("s.handovers.confirmedReservationsShowUp")
              : t("s.handovers.vehiclesOutWithCustomers"),
        }}
      />
    </PageShell>
  );
}
