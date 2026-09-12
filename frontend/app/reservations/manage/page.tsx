"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import {
  getReservations,
  type Reservation,
} from "@/lib/api";
import { ReservationStatusBadge } from "@/components/ui/Badge";

export default function ManageReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("ALL");

  async function loadReservations(showRefreshing = false) {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const data = await getReservations();
      setReservations(data);
    } catch {
      setError("Failed to load reservations.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadReservations();
  }, []);

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString();
  }

  function formatTime(date: string) {
    return new Date(date).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function isSameDay(date1: Date, date2: Date) {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  /*
   * Locations used by reservations.
   */
  const locations = useMemo(() => {
    return Array.from(
      new Set(
        reservations.flatMap((reservation) => [
          reservation.pickup_location.airport_code,
          reservation.return_location.airport_code,
        ])
      )
    ).sort();
  }, [reservations]);

  /*
   * Operational statistics.
   */
  const statistics = useMemo(() => {
    const now = new Date();

    let pickupToday = 0;
    let returnToday = 0;
    let active = 0;
    let upcoming = 0;

    reservations.forEach((reservation) => {
      if (reservation.status === "CANCELLED") {
        return;
      }

      const pickup = new Date(reservation.pickup_at);
      const rentalReturn = new Date(reservation.return_at);

      if (isSameDay(pickup, now)) {
        pickupToday++;
      }

      if (isSameDay(rentalReturn, now)) {
        returnToday++;
      }

      if (
        pickup <= now &&
        rentalReturn >= now &&
        reservation.status !== "COMPLETED"
      ) {
        active++;
      }

      if (
        pickup > now &&
        reservation.status === "CONFIRMED"
      ) {
        upcoming++;
      }
    });

    return {
      total: reservations.length,
      pickupToday,
      returnToday,
      active,
      upcoming,
    };
  }, [reservations]);

  /*
   * Filter + sort reservations.
   */
  const filteredReservations = useMemo(() => {
    const now = new Date();

    const filtered = reservations.filter((reservation) => {
      const searchValue = search.toLowerCase().trim();

      // ---------------------------------------------
      // Search
      // ---------------------------------------------

      if (searchValue) {
        const customerName =
          `${reservation.customer.first_name} ${reservation.customer.last_name}`
            .toLowerCase();

        const licensePlate =
          reservation.car.license_plate.toLowerCase();

        const reservationId =
          reservation.id.toLowerCase();

        const vehicle =
          `${reservation.car.make} ${reservation.car.model}`
            .toLowerCase();

        const matchesSearch =
          customerName.includes(searchValue) ||
          licensePlate.includes(searchValue) ||
          reservationId.includes(searchValue) ||
          vehicle.includes(searchValue);

        if (!matchesSearch) {
          return false;
        }
      }

      // ---------------------------------------------
      // Status
      // ---------------------------------------------

      if (
        statusFilter !== "ALL" &&
        reservation.status !== statusFilter
      ) {
        return false;
      }

      // ---------------------------------------------
      // Location
      // ---------------------------------------------

      if (locationFilter !== "ALL") {
        const pickupMatches =
          reservation.pickup_location.airport_code ===
          locationFilter;

        const returnMatches =
          reservation.return_location.airport_code ===
          locationFilter;

        if (!pickupMatches && !returnMatches) {
          return false;
        }
      }

      // ---------------------------------------------
      // Date
      // ---------------------------------------------

      if (dateFilter !== "ALL") {
        const pickup = new Date(reservation.pickup_at);
        const rentalReturn = new Date(
          reservation.return_at
        );

        if (dateFilter === "TODAY") {
          if (
            !isSameDay(pickup, now) &&
            !isSameDay(rentalReturn, now)
          ) {
            return false;
          }
        }

        if (dateFilter === "UPCOMING") {
          if (
            reservation.status !== "CONFIRMED" ||
            pickup <= now
          ) {
            return false;
          }
        }

        if (dateFilter === "NEXT_7_DAYS") {
          const nextWeek = new Date(now);
          nextWeek.setDate(nextWeek.getDate() + 7);

          if (
            pickup < now ||
            pickup > nextWeek
          ) {
            return false;
          }
        }

        if (dateFilter === "ACTIVE") {
          if (
            pickup > now ||
            rentalReturn < now
          ) {
            return false;
          }
        }
      }

      return true;
    });

    /*
     * Always show operationally relevant reservations first.
     *
     * Earliest pickup = first.
     */
    return filtered.sort(
      (a, b) =>
        new Date(a.pickup_at).getTime() -
        new Date(b.pickup_at).getTime()
    );
  }, [
    reservations,
    search,
    statusFilter,
    locationFilter,
    dateFilter,
  ]);

  function clearFilters() {
    setSearch("");
    setStatusFilter("ALL");
    setLocationFilter("ALL");
    setDateFilter("ALL");
  }

  function applyQuickFilter(filter: string) {
    setSearch("");
    setStatusFilter("ALL");
    setLocationFilter("ALL");
    setDateFilter(filter);
  }

  const hasFilters =
    search !== "" ||
    statusFilter !== "ALL" ||
    locationFilter !== "ALL" ||
    dateFilter !== "ALL";

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-gray-500">
            Loading reservations...
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-xl bg-white p-8 shadow-sm">
            <p className="text-red-600">{error}</p>

            <button
              onClick={() => loadReservations()}
              className="mt-4 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">

        {/* ================================================= */}
        {/* Header */}
        {/* ================================================= */}

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">

          <div>
            <h1 className="text-3xl font-bold">
              Reservations
            </h1>

            <p className="mt-2 text-gray-600">
              Manage and monitor vehicle reservations.
            </p>
          </div>

          <div className="flex gap-3">

            <button
              onClick={() => loadReservations(true)}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>

            <button
              onClick={() =>
                (window.location.href =
                  "/reservations")
              }
              className="flex items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              <Plus className="h-4 w-4" />
              New Reservation
            </button>

          </div>

        </div>

        {/* ================================================= */}
        {/* Operational overview */}
        {/* ================================================= */}

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">

          <button
            onClick={() => applyQuickFilter("ALL")}
            className="rounded-xl bg-white p-5 text-left shadow-sm transition hover:shadow-md"
          >
            <p className="text-sm text-gray-500">
              Total reservations
            </p>

            <p className="mt-2 text-3xl font-bold">
              {statistics.total}
            </p>
          </button>

          <button
            onClick={() => applyQuickFilter("TODAY")}
            className="rounded-xl bg-white p-5 text-left shadow-sm transition hover:shadow-md"
          >
            <p className="text-sm text-gray-500">
              Today's activity
            </p>

            <p className="mt-2 text-3xl font-bold">
              {statistics.pickupToday +
                statistics.returnToday}
            </p>

            <p className="mt-1 text-xs text-gray-400">
              {statistics.pickupToday} pickups ·{" "}
              {statistics.returnToday} returns
            </p>
          </button>

          <button
            onClick={() => applyQuickFilter("ACTIVE")}
            className="rounded-xl bg-white p-5 text-left shadow-sm transition hover:shadow-md"
          >
            <p className="text-sm text-gray-500">
              Active rentals
            </p>

            <p className="mt-2 text-3xl font-bold">
              {statistics.active}
            </p>
          </button>

          <button
            onClick={() =>
              applyQuickFilter("UPCOMING")
            }
            className="rounded-xl bg-white p-5 text-left shadow-sm transition hover:shadow-md"
          >
            <p className="text-sm text-gray-500">
              Upcoming
            </p>

            <p className="mt-2 text-3xl font-bold">
              {statistics.upcoming}
            </p>
          </button>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">
              Today's pickups
            </p>

            <p className="mt-2 text-3xl font-bold">
              {statistics.pickupToday}
            </p>

            <p className="mt-1 text-xs text-gray-400">
              Vehicle handovers
            </p>
          </div>

        </div>

        {/* ================================================= */}
        {/* Filters */}
        {/* ================================================= */}

        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm">

          <div className="grid gap-4 lg:grid-cols-4">

            {/* Search */}

            <div className="lg:col-span-2">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Search
              </label>

              <input
                type="text"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Customer, vehicle, plate or reservation ID..."
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 outline-none transition focus:border-black"
              />
            </div>

            {/* Status */}

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Status
              </label>

              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value)
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 outline-none focus:border-black"
              >
                <option value="ALL">
                  All statuses
                </option>

                <option value="PENDING">
                  Pending
                </option>

                <option value="CONFIRMED">
                  Confirmed
                </option>

                <option value="ACTIVE">
                  Active
                </option>

                <option value="COMPLETED">
                  Completed
                </option>

                <option value="CANCELLED">
                  Cancelled
                </option>
              </select>
            </div>

            {/* Location */}

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Location
              </label>

              <select
                value={locationFilter}
                onChange={(event) =>
                  setLocationFilter(event.target.value)
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 outline-none focus:border-black"
              >
                <option value="ALL">
                  All locations
                </option>

                {locations.map((location) => (
                  <option
                    key={location}
                    value={location}
                  >
                    {location}
                  </option>
                ))}
              </select>
            </div>

          </div>

          {/* Date filters */}

          <div className="mt-4 flex flex-wrap items-end gap-4">

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Date
              </label>

              <select
                value={dateFilter}
                onChange={(event) =>
                  setDateFilter(event.target.value)
                }
                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 outline-none focus:border-black"
              >
                <option value="ALL">
                  All dates
                </option>

                <option value="TODAY">
                  Today
                </option>

                <option value="UPCOMING">
                  Upcoming
                </option>

                <option value="NEXT_7_DAYS">
                  Next 7 days
                </option>

                <option value="ACTIVE">
                  Currently active
                </option>
              </select>
            </div>

            {hasFilters && (
              <button
                onClick={clearFilters}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Clear filters
              </button>
            )}

          </div>

        </div>

        {/* ================================================= */}
        {/* Results */}
        {/* ================================================= */}

        <div className="mb-3 flex items-center justify-between">

          <p className="text-sm text-gray-500">
            Showing{" "}
            <span className="font-medium text-gray-700">
              {filteredReservations.length}
            </span>{" "}
            of{" "}
            <span className="font-medium text-gray-700">
              {reservations.length}
            </span>{" "}
            reservations
          </p>

          <p className="hidden text-xs text-gray-400 sm:block">
            Sorted by pickup date
          </p>

        </div>

        {/* ================================================= */}
        {/* Results list */}
        {/* ================================================= */}

        <div className="overflow-hidden rounded-xl bg-white shadow-sm">

          {/* Mobile: card list — a data table doesn't reflow usefully on
              a narrow screen, so it's a table at lg and up, and a simpler
              per-reservation card list below that. */}
          <div className="divide-y lg:hidden">

            {filteredReservations.map((reservation) => (
              <button
                key={reservation.id}
                onClick={() =>
                  (window.location.href =
                    `/reservations/manage/${reservation.id}`)
                }
                className="block w-full p-4 text-left hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {reservation.customer.first_name}{" "}
                      {reservation.customer.last_name}
                    </p>

                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {reservation.car.make} {reservation.car.model}
                      {" · "}
                      {reservation.car.license_plate}
                    </p>
                  </div>

                  <ReservationStatusBadge
                    status={reservation.status}
                    className="shrink-0"
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-gray-400">Pickup</p>
                    <p className="mt-0.5 font-medium text-gray-700">
                      {formatDate(reservation.pickup_at)}
                    </p>
                    <p className="text-gray-500">
                      {formatTime(reservation.pickup_at)}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-400">Return</p>
                    <p className="mt-0.5 font-medium text-gray-700">
                      {formatDate(reservation.return_at)}
                    </p>
                    <p className="text-gray-500">
                      {formatTime(reservation.return_at)}
                    </p>
                  </div>
                </div>

                <p className="mt-2 text-xs font-medium text-gray-500">
                  {reservation.pickup_location.airport_code}
                  {" → "}
                  {reservation.return_location.airport_code}
                </p>
              </button>
            ))}

          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto lg:block">

            <table className="w-full text-left">

              <thead className="border-b bg-gray-50">

                <tr>

                  <th className="px-6 py-4 text-sm font-semibold">
                    Customer
                  </th>

                  <th className="px-6 py-4 text-sm font-semibold">
                    Vehicle
                  </th>

                  <th className="px-6 py-4 text-sm font-semibold">
                    Pickup
                  </th>

                  <th className="px-6 py-4 text-sm font-semibold">
                    Return
                  </th>

                  <th className="px-6 py-4 text-sm font-semibold">
                    Route
                  </th>

                  <th className="px-6 py-4 text-sm font-semibold">
                    Status
                  </th>

                </tr>

              </thead>

              <tbody>

                {filteredReservations.map(
                  (reservation) => (

                    <tr
                      key={reservation.id}
                      onClick={() =>
                        (window.location.href =
                          `/reservations/manage/${reservation.id}`)
                      }
                      className="cursor-pointer border-b last:border-b-0 hover:bg-gray-50"
                    >

                      {/* Customer */}

                      <td className="px-6 py-5">

                        <div className="font-medium">
                          {
                            reservation.customer
                              .first_name
                          }{" "}
                          {
                            reservation.customer
                              .last_name
                          }
                        </div>

                        <div className="mt-1 max-w-[180px] truncate text-xs text-gray-400">
                          {reservation.id}
                        </div>

                      </td>

                      {/* Vehicle */}

                      <td className="px-6 py-5">

                        <div className="font-medium">
                          {reservation.car.make}{" "}
                          {reservation.car.model}
                        </div>

                        <div className="mt-1 text-sm text-gray-500">
                          {
                            reservation.car
                              .license_plate
                          }
                        </div>

                      </td>

                      {/* Pickup */}

                      <td className="px-6 py-5">

                        <div className="font-medium">
                          {formatDate(
                            reservation.pickup_at
                          )}
                        </div>

                        <div className="text-sm text-gray-500">
                          {formatTime(
                            reservation.pickup_at
                          )}
                        </div>

                      </td>

                      {/* Return */}

                      <td className="px-6 py-5">

                        <div className="font-medium">
                          {formatDate(
                            reservation.return_at
                          )}
                        </div>

                        <div className="text-sm text-gray-500">
                          {formatTime(
                            reservation.return_at
                          )}
                        </div>

                      </td>

                      {/* Route */}

                      <td className="px-6 py-5">

                        <span className="text-sm font-medium">
                          {
                            reservation
                              .pickup_location
                              .airport_code
                          }
                        </span>

                        <span className="mx-2 text-gray-400">
                          →
                        </span>

                        <span className="text-sm font-medium">
                          {
                            reservation
                              .return_location
                              .airport_code
                          }
                        </span>

                      </td>

                      {/* Status */}

                      <td className="px-6 py-5">

                        <ReservationStatusBadge status={reservation.status} />

                      </td>

                    </tr>

                  )
                )}

              </tbody>

            </table>

          </div>

        </div>

        {/* ================================================= */}
        {/* Empty state */}
        {/* ================================================= */}

        {filteredReservations.length === 0 && (
          <div className="mt-6 rounded-xl bg-white p-10 text-center shadow-sm">

            <p className="font-medium text-gray-700">
              No reservations found
            </p>

            <p className="mt-1 text-sm text-gray-500">
              Try changing your search or filters.
            </p>

            {hasFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 text-sm font-medium underline"
              >
                Clear filters
              </button>
            )}

          </div>
        )}

      </div>
    </main>
  );
}