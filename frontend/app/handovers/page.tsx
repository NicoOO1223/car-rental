"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, CalendarDays, RefreshCw } from "lucide-react";

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
import { formatAge, formatDateTime, formatDayTime, instantToZoned, todayInZone } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { useUrlFilters } from "@/lib/useUrlFilters";
import { t } from "@/lib/i18n";

const FILTER_DEFAULTS = {
  tab: "check-in",
  // "today" keeps only what is due today; everything else is "all".
  day: "all",
};

type Tab = "check-in" | "check-out";

const QUEUE_LIMIT = 100;

/** Whether an instant falls on today's date at the place it happens (that place's own clocks). */
function isToday(iso: string, timeZone: string): boolean {
  return instantToZoned(iso, timeZone).date === todayInZone(timeZone);
}

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
  // Kept for the session, so the counter finds the list the way it was left.
  const { filters, setFilters } = useUrlFilters(FILTER_DEFAULTS, { persist: true });
  const tab: Tab = filters.tab === "check-out" ? "check-out" : "check-in";
  const todayOnly = filters.day === "today";

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
    cell: (reservation) => (
      <span className="font-semibold text-ink">
        {reservation.customer.first_name} {reservation.customer.last_name}
      </span>
    ),
    mobileCell: (reservation) =>
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

  // Each tab leads with the moment staff act on: the pickup when handing a car
  // over, the due time when taking one back. The other end of the rental is a
  // column people can switch on from the table's View menu.
  const pickupColumn: Column<Reservation> = {
    id: "pickup",
    header: t("s.handovers.pickup"),
    mobileLabel: t("s.handovers.pickup"),
    hideable: tab !== "check-in",
    defaultHidden: tab !== "check-in",
    cellClassName: "whitespace-nowrap tabular-nums",
    cell: (reservation) => (
      <TwoLine
        primary={formatDayTime(reservation.pickup_at, reservation.pickup_location.timezone, now)}
        secondary={reservation.pickup_location.airport_code}
      />
    ),
    mobileCell: (reservation) =>
      `${formatDayTime(reservation.pickup_at, reservation.pickup_location.timezone, now)} · ${reservation.pickup_location.airport_code}`,
    sortable: true,
    sortAccessor: (reservation) => new Date(reservation.pickup_at),
  };

  const returnColumn: Column<Reservation> = {
    id: "return",
    header: tab === "check-in" ? t("s.handovers.return") : t("s.handovers.returnDue"),
    mobileLabel: t("s.handovers.return"),
    hideable: tab === "check-in",
    cellClassName: "whitespace-nowrap tabular-nums",
    cell: (reservation) => {
      const late = tab === "check-out" ? lateLabel(reservation.return_at, now) : null;

      return (
        <TwoLine
          primary={formatDayTime(reservation.return_at, reservation.return_location.timezone, now)}
          secondary={
            late ? (
              <span className="font-semibold text-danger">{late}</span>
            ) : (
              reservation.return_location.airport_code
            )
          }
        />
      );
    },
    mobileCell: (reservation) => {
      const late = tab === "check-out" ? lateLabel(reservation.return_at, now) : null;

      return (
        <>
          {formatDayTime(reservation.return_at, reservation.return_location.timezone, now)} · {reservation.return_location.airport_code}
          {late && <span className="ml-1.5 font-semibold text-danger">{late}</span>}
        </>
      );
    },
    sortable: true,
    sortAccessor: (reservation) => new Date(reservation.return_at),
  };

  const bookedColumn: Column<Reservation> = {
    id: "booked",
    header: t("s.handovers.booked"),
    mobile: "hidden",
    hideable: true,
    defaultHidden: true,
    cellClassName: "whitespace-nowrap tabular-nums",
    cell: (reservation) => <span title={formatDateTime(reservation.created_at)}>{formatAge(reservation.created_at, now)}</span>,
    sortable: true,
    sortAccessor: (reservation) => new Date(reservation.created_at),
  };

  const columns: Column<Reservation>[] =
    tab === "check-in"
      ? [customerColumn, vehicleColumn, pickupColumn, returnColumn, bookedColumn]
      : [customerColumn, vehicleColumn, returnColumn, pickupColumn, bookedColumn];

  // A pickup counts as today by the clocks of the place the car is handed over at,
  // a return by the clocks of the place it comes back to.
  const dueToday = {
    "check-in": awaitingCheckIn.filter((r) => isToday(r.pickup_at, r.pickup_location.timezone)),
    "check-out": awaitingCheckOut.filter((r) => isToday(r.return_at, r.return_location.timezone)),
  };
  // Overdue, but only the returns that were due earlier today (an older one is not "today").
  const overdueToday = dueToday["check-out"].filter((r) => new Date(r.return_at).getTime() < now).length;
  const queue = tab === "check-in" ? awaitingCheckIn : awaitingCheckOut;
  const rows = todayOnly ? dueToday[tab] : queue;

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
        <div className="rounded-2xl border border-border-subtle bg-surface p-8">
          <p className="text-danger" role="alert">
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
          value={todayOnly ? dueToday["check-in"].length : checkInTotal}
          icon={ArrowLeftRight}
        />
        <StatTile
          label={t("s.handovers.awaitingCheckOut")}
          value={todayOnly ? dueToday["check-out"].length : checkOutTotal}
          icon={ArrowLeftRight}
        />
        <StatTile
          label={t("s.handovers.overdueReturns")}
          value={todayOnly ? overdueToday : overdueCount}
          icon={ArrowLeftRight}
        />
      </StatTileGrid>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SubNav
          activeId={tab}
          onSelect={(id) => setFilters({ tab: id })}
          items={[
            { id: "check-in", label: t("s.handovers.check"), count: todayOnly ? dueToday["check-in"].length : checkInTotal },
            { id: "check-out", label: t("s.handovers.checkOut"), count: todayOnly ? dueToday["check-out"].length : checkOutTotal },
          ]}
        />

        <button
          type="button"
          aria-pressed={todayOnly}
          onClick={() => setFilters({ day: todayOnly ? "all" : "today" })}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
            todayOnly
              ? "border-accent bg-accent-soft text-accent-ink"
              : "border-border-strong bg-surface text-ink-secondary hover:bg-surface-sunken"
          }`}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          {t("s.handovers.todayOnly")}
        </button>
      </div>

      {!todayOnly && (tab === "check-in" ? checkInTotal : checkOutTotal) > QUEUE_LIMIT && (
        <p className="mb-3 text-sm text-ink-muted">{t("s.handovers.showingFirstWorkThrough", { limit: QUEUE_LIMIT, total: tab === "check-in" ? checkInTotal : checkOutTotal })}</p>
      )}

      <DataTable
        key={tab}
        tableId={`handovers-${tab}`}
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
            variant: "primary",
          },
        ]}
        empty={
          todayOnly
            ? {
                icon: ArrowLeftRight,
                title: tab === "check-in" ? t("s.handovers.nothingCheckInToday") : t("s.handovers.nothingCheckOutToday"),
                description: t("s.handovers.nothingTodayHint"),
              }
            : {
                icon: ArrowLeftRight,
                title:
                  tab === "check-in"
                    ? t("s.handovers.nothingWaitingCheck")
                    : t("s.handovers.nothingWaitingCheckOut"),
                description:
                  tab === "check-in"
                    ? t("s.handovers.confirmedReservationsShowUp")
                    : t("s.handovers.vehiclesOutWithCustomers"),
              }
        }
      />
    </PageShell>
  );
}
