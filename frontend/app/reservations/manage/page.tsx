"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Plus, RefreshCw } from "lucide-react";

import {
  getLocations,
  getReservations,
  getReservationSummary,
  localDayBounds,
  type Location,
  type Reservation,
  type ReservationSummary,
} from "@/lib/api";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { Pagination } from "@/components/ui/Pagination";
import { Toolbar } from "@/components/ui/Toolbar";
import { bookingReference, formatDate, formatTime } from "@/lib/format";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useNavigate } from "@/lib/useNavigate";
import { useUrlFilters } from "@/lib/useUrlFilters";

const FILTER_DEFAULTS = {
  q: "",
  status: "ALL",
  location: "ALL",
  window: "ALL",
  sort: "pickup_asc",
  page: "1",
};

const PAGE_SIZE = 25;

export default function ManageReservationsPage() {
  const navigate = useNavigate();
  const { filters, setFilters, clearFilters, isFiltered } =
    useUrlFilters(FILTER_DEFAULTS);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ReservationSummary | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Bumped by "Refresh" and "Try again" to re-run the loader effect.
  const [reloadKey, setReloadKey] = useState(0);

  const page = Number(filters.page) || 1;
  // The URL updates on every keystroke; the server is only asked once
  // typing pauses.
  const search = useDebouncedValue(filters.q);

  useEffect(() => {
    getLocations()
      .then(setLocations)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const { dayStart, dayEnd } = localDayBounds();

        const [list, counts] = await Promise.all([
          getReservations({
            q: search,
            status: filters.status === "ALL" ? undefined : filters.status,
            location: filters.location === "ALL" ? undefined : filters.location,
            window: filters.window === "ALL" ? undefined : filters.window,
            sort: filters.sort,
            dayStart,
            dayEnd,
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
          }),
          getReservationSummary(dayStart, dayEnd),
        ]);

        if (cancelled) return;
        setReservations(list.items);
        setTotal(list.total);
        setSummary(counts);
      } catch {
        if (!cancelled) setError("Failed to load reservations.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [
    search,
    filters.status,
    filters.location,
    filters.window,
    filters.sort,
    page,
    reloadKey,
  ]);

  function reload() {
    setRefreshing(true);
    setReloadKey((key) => key + 1);
  }

  // Any filter change goes back to the first page.
  function updateFilters(patch: Partial<typeof filters>) {
    setFilters({ ...patch, page: "1" });
  }

  // The quick-filter tiles reset every other filter, so a tile is either
  // the whole current view or it is not active at all.
  function applyQuickFilter(window: string) {
    updateFilters({ q: "", status: "ALL", location: "ALL", window });
  }

  const quickFilterActive = (window: string) =>
    filters.window === window &&
    filters.q === "" &&
    filters.status === "ALL" &&
    filters.location === "ALL";

  const columns: Column<Reservation>[] = [
    {
      id: "customer",
      header: "Customer",
      mobile: "primary",
      cell: (reservation) => (
        <TwoLine
          primary={`${reservation.customer.first_name} ${reservation.customer.last_name}`}
          secondary={
            <span className="font-mono text-xs">
              {bookingReference(reservation.id)}
            </span>
          }
        />
      ),
      mobileCell: (reservation) =>
        `${reservation.customer.first_name} ${reservation.customer.last_name}`,
    },
    {
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
    },
    {
      id: "pickup",
      header: "Pickup",
      mobileLabel: "Pickup",
      cell: (reservation) => (
        <TwoLine
          primary={formatDate(reservation.pickup_at)}
          secondary={formatTime(reservation.pickup_at)}
        />
      ),
      mobileCell: (reservation) => (
        <>
          <div>{formatDate(reservation.pickup_at)}</div>
          <div className="font-normal text-ink-muted">
            {formatTime(reservation.pickup_at)}
          </div>
        </>
      ),
    },
    {
      id: "return",
      header: "Return",
      mobileLabel: "Return",
      cell: (reservation) => (
        <TwoLine
          primary={formatDate(reservation.return_at)}
          secondary={formatTime(reservation.return_at)}
        />
      ),
      mobileCell: (reservation) => (
        <>
          <div>{formatDate(reservation.return_at)}</div>
          <div className="font-normal text-ink-muted">
            {formatTime(reservation.return_at)}
          </div>
        </>
      ),
    },
    {
      id: "booked",
      header: "Booked",
      mobile: "hidden",
      cell: (reservation) => (
        <TwoLine
          primary={formatDate(reservation.created_at)}
          secondary={formatTime(reservation.created_at)}
        />
      ),
    },
    {
      id: "route",
      header: "Route",
      mobile: "hidden",
      cell: (reservation) => (
        <span className="text-sm font-medium text-ink">
          {reservation.pickup_location.airport_code}
          <span className="mx-2 text-ink-muted" aria-hidden="true">
            →
          </span>
          {reservation.return_location.airport_code}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "trailing",
      cell: (reservation) => (
        <ReservationStatusBadge status={reservation.status} />
      ),
    },
  ];

  if (error) {
    return (
      <PageShell>
        <div className="rounded-xl bg-surface p-8 shadow-sm">
          <p className="text-red-600" role="alert">
            {error}
          </p>

          <Button className="mt-4" onClick={reload}>
            Try again
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Reservations"
        description="Manage and monitor vehicle reservations."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={reload}
              disabled={refreshing}
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {refreshing ? "Refreshing" : "Refresh"}
            </Button>

            <Button onClick={() => navigate("/reservations/new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New reservation
            </Button>
          </>
        }
      />

      <StatTileGrid columns={4} className="mb-8">
        <StatTile
          label="All reservations"
          value={summary?.total ?? "–"}
          onClick={() => applyQuickFilter("ALL")}
          active={quickFilterActive("ALL")}
        />
        <StatTile
          label={"Today’s activity"}
          value={summary ? summary.pickup_today + summary.return_today : "–"}
          hint={
            summary
              ? `${summary.pickup_today} out, ${summary.return_today} back`
              : undefined
          }
          onClick={() => applyQuickFilter("TODAY")}
          active={quickFilterActive("TODAY")}
        />
        <StatTile
          label="On the road"
          value={summary?.active ?? "–"}
          onClick={() => applyQuickFilter("ACTIVE")}
          active={quickFilterActive("ACTIVE")}
        />
        <StatTile
          label="Upcoming"
          value={summary?.upcoming ?? "–"}
          onClick={() => applyQuickFilter("UPCOMING")}
          active={quickFilterActive("UPCOMING")}
        />
      </StatTileGrid>

      <Toolbar
        footer={
          <>
            <p>
              <span className="font-medium text-ink">{total}</span>{" "}
              {isFiltered ? "matching reservations" : "reservations"}
            </p>

            {isFiltered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </>
        }
      >
        <Field label="Search">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="search"
              value={filters.q}
              onChange={(event) => updateFilters({ q: event.target.value })}
              placeholder="Customer, plate or vehicle..."
            />
          )}
        </Field>

        <Field label="Status">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.status}
              onChange={(event) => updateFilters({ status: event.target.value })}
            >
              <option value="ALL">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          )}
        </Field>

        <Field label="Location">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.location}
              onChange={(event) => updateFilters({ location: event.target.value })}
            >
              <option value="ALL">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.airport_code}>
                  {location.airport_code}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Period">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.window}
              onChange={(event) => updateFilters({ window: event.target.value })}
            >
              <option value="ALL">Any time</option>
              <option value="TODAY">Today</option>
              <option value="ACTIVE">On the road</option>
              <option value="UPCOMING">Upcoming</option>
              <option value="NEXT_7_DAYS">Next 7 days</option>
            </Select>
          )}
        </Field>

        <Field label="Sort by">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.sort}
              onChange={(event) => updateFilters({ sort: event.target.value })}
            >
              <option value="pickup_asc">Pickup, soonest first</option>
              <option value="pickup_desc">Pickup, latest first</option>
              <option value="return_asc">Return, soonest first</option>
              <option value="created_desc">Recently booked</option>
            </Select>
          )}
        </Field>
      </Toolbar>

      <DataTable
        rows={reservations}
        columns={columns}
        rowKey={(reservation) => reservation.id}
        loading={loading}
        onRowClick={(reservation) =>
          navigate(`/reservations/manage/${reservation.id}`)
        }
        empty={{
          icon: CalendarClock,
          title: isFiltered ? "No reservations match" : "No reservations yet",
          description: isFiltered
            ? "Try changing your search or filters."
            : "Bookings appear here as soon as they are created.",
          action: isFiltered ? (
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : (
            <Button onClick={() => navigate("/reservations/new")}>
              New reservation
            </Button>
          ),
        }}
      />

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={(next) => setFilters({ page: String(next) })}
      />
    </PageShell>
  );
}
