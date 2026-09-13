"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, RefreshCw } from "lucide-react";

import { getReservations, type Reservation } from "@/lib/api";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { Toolbar } from "@/components/ui/Toolbar";
import { bookingReference, formatDate, formatTime } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { useUrlFilters } from "@/lib/useUrlFilters";

const FILTER_DEFAULTS = {
  q: "",
  status: "ALL",
  location: "ALL",
  window: "ALL",
};

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function ManageReservationsPage() {
  const navigate = useNavigate();
  const { filters, setFilters, clearFilters, isFiltered } =
    useUrlFilters(FILTER_DEFAULTS);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function loadReservations(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    setError("");

    try {
      setReservations(await getReservations());
    } catch {
      setError("Failed to load reservations.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        setReservations(await getReservations());
      } catch {
        setError("Failed to load reservations.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const locations = useMemo(
    () =>
      Array.from(
        new Set(
          reservations.flatMap((reservation) => [
            reservation.pickup_location.airport_code,
            reservation.return_location.airport_code,
          ]),
        ),
      ).sort(),
    [reservations],
  );

  const statistics = useMemo(() => {
    const now = new Date();

    let pickupToday = 0;
    let returnToday = 0;
    let active = 0;
    let upcoming = 0;

    for (const reservation of reservations) {
      if (reservation.status === "CANCELLED") continue;

      const pickup = new Date(reservation.pickup_at);
      const rentalReturn = new Date(reservation.return_at);

      if (isSameDay(pickup, now)) pickupToday++;
      if (isSameDay(rentalReturn, now)) returnToday++;

      if (
        pickup <= now &&
        rentalReturn >= now &&
        reservation.status !== "COMPLETED"
      ) {
        active++;
      }

      if (pickup > now && reservation.status === "CONFIRMED") upcoming++;
    }

    return {
      total: reservations.length,
      pickupToday,
      returnToday,
      active,
      upcoming,
    };
  }, [reservations]);

  const filteredReservations = useMemo(() => {
    const now = new Date();
    const searchValue = filters.q.toLowerCase().trim();

    const filtered = reservations.filter((reservation) => {
      if (searchValue) {
        const haystack = [
          `${reservation.customer.first_name} ${reservation.customer.last_name}`,
          reservation.car.license_plate,
          reservation.id,
          `${reservation.car.make} ${reservation.car.model}`,
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(searchValue)) return false;
      }

      if (filters.status !== "ALL" && reservation.status !== filters.status) {
        return false;
      }

      if (filters.location !== "ALL") {
        const matches =
          reservation.pickup_location.airport_code === filters.location ||
          reservation.return_location.airport_code === filters.location;

        if (!matches) return false;
      }

      if (filters.window !== "ALL") {
        const pickup = new Date(reservation.pickup_at);
        const rentalReturn = new Date(reservation.return_at);

        if (
          filters.window === "TODAY" &&
          !isSameDay(pickup, now) &&
          !isSameDay(rentalReturn, now)
        ) {
          return false;
        }

        if (
          filters.window === "UPCOMING" &&
          (reservation.status !== "CONFIRMED" || pickup <= now)
        ) {
          return false;
        }

        if (filters.window === "NEXT_7_DAYS") {
          const nextWeek = new Date(now);
          nextWeek.setDate(nextWeek.getDate() + 7);

          if (pickup < now || pickup > nextWeek) return false;
        }

        if (
          filters.window === "ACTIVE" &&
          (pickup > now || rentalReturn < now)
        ) {
          return false;
        }
      }

      return true;
    });

    // Operationally relevant first: earliest pickup at the top. The table's
    // own sort starts unsorted, so this is the default the user sees.
    return filtered.sort(
      (a, b) =>
        new Date(a.pickup_at).getTime() - new Date(b.pickup_at).getTime(),
    );
  }, [
    reservations,
    filters.q,
    filters.status,
    filters.location,
    filters.window,
  ]);

  // The quick-filter tiles reset every other filter, so a tile is either
  // the whole current view or it is not active at all.
  function applyQuickFilter(window: string) {
    setFilters({ q: "", status: "ALL", location: "ALL", window });
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
      sortable: true,
      sortAccessor: (reservation) =>
        `${reservation.customer.last_name} ${reservation.customer.first_name}`,
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
      sortable: true,
      sortAccessor: (reservation) =>
        `${reservation.car.make} ${reservation.car.model}`,
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
      sortable: true,
      sortAccessor: (reservation) => new Date(reservation.pickup_at),
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
      sortable: true,
      sortAccessor: (reservation) => new Date(reservation.return_at),
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
      sortable: true,
      sortAccessor: (reservation) => reservation.status,
    },
  ];

  if (error) {
    return (
      <PageShell>
        <div className="rounded-xl bg-surface p-8 shadow-sm">
          <p className="text-red-600" role="alert">
            {error}
          </p>

          <Button className="mt-4" onClick={() => loadReservations(true)}>
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
              onClick={() => loadReservations(true)}
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
          value={statistics.total}
          onClick={() => applyQuickFilter("ALL")}
          active={quickFilterActive("ALL")}
        />
        <StatTile
          label={"Today’s activity"}
          value={statistics.pickupToday + statistics.returnToday}
          hint={`${statistics.pickupToday} out, ${statistics.returnToday} back`}
          onClick={() => applyQuickFilter("TODAY")}
          active={quickFilterActive("TODAY")}
        />
        <StatTile
          label="On the road"
          value={statistics.active}
          onClick={() => applyQuickFilter("ACTIVE")}
          active={quickFilterActive("ACTIVE")}
        />
        <StatTile
          label="Upcoming"
          value={statistics.upcoming}
          onClick={() => applyQuickFilter("UPCOMING")}
          active={quickFilterActive("UPCOMING")}
        />
      </StatTileGrid>

      <Toolbar
        footer={
          <>
            <p>
              Showing{" "}
              <span className="font-medium text-ink">
                {filteredReservations.length}
              </span>{" "}
              of{" "}
              <span className="font-medium text-ink">
                {reservations.length}
              </span>{" "}
              reservations
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
              onChange={(event) => setFilters({ q: event.target.value })}
              placeholder="Customer, plate or vehicle..."
            />
          )}
        </Field>

        <Field label="Status">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.status}
              onChange={(event) => setFilters({ status: event.target.value })}
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
              onChange={(event) => setFilters({ location: event.target.value })}
            >
              <option value="ALL">All locations</option>
              {locations.map((code) => (
                <option key={code} value={code}>
                  {code}
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
              onChange={(event) => setFilters({ window: event.target.value })}
            >
              <option value="ALL">Any time</option>
              <option value="TODAY">Today</option>
              <option value="ACTIVE">On the road</option>
              <option value="UPCOMING">Upcoming</option>
              <option value="NEXT_7_DAYS">Next 7 days</option>
            </Select>
          )}
        </Field>
      </Toolbar>

      <DataTable
        rows={filteredReservations}
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
    </PageShell>
  );
}
