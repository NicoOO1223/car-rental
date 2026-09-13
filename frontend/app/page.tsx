"use client";

import { useEffect, useState } from "react";

import {
  getDashboard,
  getLocations,
  getFleetStatus,
  type Dashboard,
  type Location,
  type FleetStatus,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { UpcomingCard } from "@/components/dashboard/UpcomingCard";
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

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
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
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
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
    <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-ink">
            Overview
          </h1>

          <p className="mt-2 text-ink-secondary">
            Your fleet and reservations at a glance.
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

        {/* Next pickups + Next returns */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <UpcomingCard
            direction="pickup"
            reservations={dashboard.upcoming_pickups}
            viewAllHref="/reservations/manage?window=UPCOMING"
          />

          <UpcomingCard
            direction="return"
            reservations={dashboard.upcoming_returns}
            viewAllHref="/reservations/manage?window=ACTIVE"
          />
        </div>

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
                  aria-label="Filter fleet status by airport"
                  value={airportFilter}
                  onChange={(event) => setAirportFilter(event.target.value)}
                  className="rounded-lg border border-border-strong bg-white px-3 py-2 text-sm text-ink transition focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
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
                  aria-label="Fleet status date"
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value)}
                  className="rounded-lg border border-border-strong bg-white px-3 py-2 text-sm text-ink transition focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
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

      </div>
    </main>
  );
}
