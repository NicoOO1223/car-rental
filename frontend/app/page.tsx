"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import {
  getDashboard,
  getLocations,
  getFleetStatus,
  type Dashboard,
  type Location,
  type FleetStatus,
} from "@/lib/api";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getCarStatusHex } from "@/lib/status";
import { PieChart, type PieChartDatum } from "@/components/charts/PieChart";
import { Skeleton, SkeletonStatTiles } from "@/components/ui/Skeleton";
import { useNavigate } from "@/lib/useNavigate";

const FLEET_STATUS_ORDER: { key: string; label: string }[] = [
  { key: "available", label: "Available" },
  { key: "reserved", label: "Reserved" },
  { key: "rented", label: "Rented" },
  { key: "maintenance", label: "Maintenance" },
  { key: "cleaning", label: "Cleaning" },
];

function todayDateString() {
  return new Date().toISOString().split("T")[0];
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] =
    useState<Dashboard | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [locations, setLocations] = useState<Location[]>([]);
  const [airportFilter, setAirportFilter] = useState("");
  const [dateFilter, setDateFilter] = useState(todayDateString());

  const [fleetStatus, setFleetStatus] = useState<FleetStatus | null>(null);
  const [fleetStatusLoading, setFleetStatusLoading] = useState(true);
  const [fleetStatusError, setFleetStatusError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const data = await getDashboard();

        setDashboard(data);
      } catch {
        setError("Failed to load dashboard.");
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  useEffect(() => {
    async function loadLocations() {
      try {
        const data = await getLocations();

        setLocations(data);
      } catch {
        // Non-fatal — the airport filter just stays empty.
      }
    }

    loadLocations();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFleetStatus() {
      setFleetStatusLoading(true);
      setFleetStatusError("");

      try {
        const data = await getFleetStatus({
          date: dateFilter,
          locationId: airportFilter || undefined,
        });

        if (!cancelled) {
          setFleetStatus(data);
        }
      } catch {
        if (!cancelled) {
          setFleetStatusError("Failed to load fleet status.");
        }
      } finally {
        if (!cancelled) {
          setFleetStatusLoading(false);
        }
      }
    }

    loadFleetStatus();

    return () => {
      cancelled = true;
    };
  }, [airportFilter, dateFilter]);

  function formatDateTime(date: string) {
    return new Date(date).toLocaleString([], {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <Skeleton className="mb-8 h-9 w-48" />
          <SkeletonStatTiles count={2} className="mb-6 grid gap-4 sm:grid-cols-2" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !dashboard) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-red-600">
            {error || "Failed to load dashboard."}
          </p>
        </div>
      </main>
    );
  }

  const pieData: PieChartDatum[] = fleetStatus
    ? FLEET_STATUS_ORDER.map(({ key, label }) => ({
        key,
        label,
        value: fleetStatus.counts[
          key as keyof typeof fleetStatus.counts
        ],
        color: getCarStatusHex(key.toUpperCase()),
      }))
    : [];

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            Dashboard
          </h1>

          <p className="mt-2 text-gray-600">
            Overview of your fleet and reservations.
          </p>
        </div>

        {/* Today's activity */}
        <section className="mb-8">

          <h2 className="mb-4 text-lg font-semibold">
            Today
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">

            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">
                Pickups today
              </p>

              <p className="mt-2 text-3xl font-bold">
                {dashboard.today.pickups}
              </p>

              <p className="mt-2 text-sm text-gray-500">
                Vehicles scheduled for pickup
              </p>
            </div>

            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">
                Returns today
              </p>

              <p className="mt-2 text-3xl font-bold">
                {dashboard.today.returns}
              </p>

              <p className="mt-2 text-sm text-gray-500">
                Vehicles scheduled for return
              </p>
            </div>

          </div>

        </section>

        {/* Fleet status + Fleet by location */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">

          {/* Fleet status — the Reservations stat tiles that used to sit
              beside this were removed as redundant with this pie chart. */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  Fleet status
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Vehicle status as of the selected date
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={airportFilter}
                  onChange={(event) =>
                    setAirportFilter(event.target.value)
                  }
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                >
                  <option value="">All airports</option>

                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.airport_code}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={dateFilter}
                  onChange={(event) =>
                    setDateFilter(event.target.value)
                  }
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                />
              </div>
            </div>

            <div className="mt-6">
              {fleetStatusLoading ? (
                <p className="text-sm text-gray-500">
                  Loading fleet status...
                </p>
              ) : fleetStatusError ? (
                <p className="text-sm text-red-600">{fleetStatusError}</p>
              ) : (
                <PieChart data={pieData} />
              )}
            </div>
          </Card>

          {/* Fleet by location */}
          <Card>
            <h2 className="text-lg font-semibold">
              Fleet by location
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Current vehicle distribution
            </p>

            <div className="mt-6 space-y-5">

              {dashboard.locations.map(
                (location) => (
                  <button
                    key={location.airport_code}
                    onClick={() =>
                      navigate(`/cars#${location.airport_code}`)
                    }
                    className="block w-full rounded-lg text-left transition hover:bg-gray-50"
                  >

                    <div className="flex items-center justify-between">

                      <div>
                        <p className="font-medium">
                          {location.airport_code}
                        </p>

                        <p className="text-sm text-gray-500">
                          {location.name}
                        </p>
                      </div>

                      <p className="font-semibold">
                        {location.total}
                      </p>

                    </div>

                    <div className="mt-3 flex gap-2 text-xs">

                      <span className="rounded bg-gray-100 px-2 py-1 text-gray-700">
                        {location.available} available
                      </span>

                      {location.reserved > 0 && (
                        <span className="rounded bg-gray-100 px-2 py-1 text-gray-700">
                          {location.reserved} reserved
                        </span>
                      )}

                      {location.rented > 0 && (
                        <span className="rounded bg-gray-900 px-2 py-1 text-white">
                          {location.rented} rented
                        </span>
                      )}

                    </div>

                  </button>
                )
              )}

            </div>

          </Card>

        </div>

        {/* Upcoming reservations */}
        <section className="mt-8 rounded-xl bg-white p-6 shadow-sm">

          <div className="flex items-center justify-between">

            <div>
              <h2 className="text-lg font-semibold">
                Upcoming reservations
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Next scheduled pickups
              </p>
            </div>

            <button
              onClick={() =>
                navigate("/reservations/manage")
              }
              className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-black"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </button>

          </div>

          {dashboard.upcoming_reservations.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed p-8 text-center">

              <p className="font-medium text-gray-700">
                No upcoming reservations
              </p>

              <p className="mt-1 text-sm text-gray-500">
                There are no future bookings.
              </p>

            </div>
          ) : (
            <div className="mt-6 max-h-[420px] divide-y overflow-y-auto pr-1">

              {dashboard.upcoming_reservations.map(
                (reservation) => (
                  <button
                    key={reservation.id}
                    onClick={() =>
                      navigate(`/reservations/manage/${reservation.id}`)
                    }
                    className="flex w-full flex-col gap-3 py-4 text-left hover:bg-gray-50 md:flex-row md:items-center md:justify-between"
                  >

                    <div>
                      <p className="font-medium">
                        {
                          reservation
                            .customer_first_name
                        }{" "}
                        {
                          reservation
                            .customer_last_name
                        }
                      </p>

                      <p className="mt-1 text-sm text-gray-500">
                        {reservation.car_make}{" "}
                        {reservation.car_model}
                        {" · "}
                        {reservation.car_license_plate}
                      </p>
                    </div>

                    <div className="md:text-right">

                      <p className="font-medium">
                        {formatDateTime(
                          reservation.pickup_at
                        )}
                      </p>

                      <p className="mt-1 text-sm text-gray-500">
                        {
                          reservation
                            .pickup_location_code
                        }
                        {" → "}
                        {
                          reservation
                            .return_location_code
                        }
                      </p>

                    </div>

                    <ReservationStatusBadge
                      status={reservation.status}
                      className="self-start md:self-auto"
                    />

                  </button>
                )
              )}

            </div>
          )}

        </section>

      </div>
    </main>
  );
}
