"use client";

import { useEffect, useRef, useState } from "react";

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

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** This week's Mon–Sun as date-input values, so staff can jump straight
 * to any day in the current week instead of picking two dates by hand. */
function currentWeekDates(): { label: string; date: string }[] {
  const today = new Date();
  const day = today.getUTCDay(); // 0 (Sun) – 6 (Sat)
  const mondayOffset = day === 0 ? -6 : 1 - day;

  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + mondayOffset);

  return WEEKDAY_LABELS.map((label, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);

    return { label, date: date.toISOString().split("T")[0] };
  });
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

  // Narrows upcoming_pickups/upcoming_returns to a specific window —
  // "" on both means the default "everything from now on" view.
  const [upcomingStartDate, setUpcomingStartDate] = useState("");
  const [upcomingEndDate, setUpcomingEndDate] = useState("");
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const hasLoadedDashboardRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      if (hasLoadedDashboardRef.current) {
        // Not the first load — a range filter changed. Only dim the
        // pickups/returns section instead of re-showing the full-page
        // skeleton over panels that aren't affected by this filter.
        setUpcomingLoading(true);
      } else {
        setLoading(true);
      }

      try {
        const data = await getDashboard({
          startDate: upcomingStartDate || undefined,
          endDate: upcomingEndDate || undefined,
        });

        if (!cancelled) {
          setDashboard(data);
          hasLoadedDashboardRef.current = true;
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load dashboard.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setUpcomingLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [upcomingStartDate, upcomingEndDate]);

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
        <h2 className="mt-8 text-lg font-semibold text-ink">Pickups &amp; returns</h2>

        {/* A grid (full-width filter row, then a 2-col card row) rather
            than nesting the filter above just the pickups card — that
            made the pickups card start lower than returns, since each
            column sized itself independently. Spanning the filter across
            both columns also gives it the room it needs to keep the
            weekday buttons and date range on one line instead of
            wrapping. */}
        <div className="mt-8 grid gap-x-6 gap-y-3 lg:grid-cols-2">
          {/* The range still applies to both lists — getDashboard()
              takes one shared start/end pair (see the effect above). */}
          <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
            <button
              type="button"
              onClick={() => {
                setUpcomingStartDate("");
                setUpcomingEndDate("");
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                !upcomingStartDate && !upcomingEndDate
                  ? "bg-gray-900 text-white"
                  : "bg-surface-sunken text-ink-secondary hover:text-ink"
              }`}
            >
              All upcoming
            </button>

            {currentWeekDates().map(({ label, date }) => (
              <button
                key={date}
                type="button"
                onClick={() => {
                  setUpcomingStartDate(date);
                  setUpcomingEndDate(date);
                }}
                title={date === todayDateString() ? `${label} (today)` : label}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  upcomingStartDate === date && upcomingEndDate === date
                    ? "bg-gray-900 text-white"
                    : date === todayDateString()
                      ? "bg-surface-sunken text-ink ring-1 ring-inset ring-border-strong"
                      : "bg-surface-sunken text-ink-secondary hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}

            <input
              type="date"
              aria-label="From date"
              value={upcomingStartDate}
              onChange={(event) => setUpcomingStartDate(event.target.value)}
              className="rounded-lg border border-border-strong bg-white px-3 py-1.5 text-sm text-ink transition focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />

            <span className="text-ink-muted" aria-hidden="true">
              –
            </span>

            <input
              type="date"
              aria-label="To date"
              value={upcomingEndDate}
              onChange={(event) => setUpcomingEndDate(event.target.value)}
              className="rounded-lg border border-border-strong bg-white px-3 py-1.5 text-sm text-ink transition focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>

          <div className={`transition-opacity ${upcomingLoading ? "opacity-50" : ""}`}>
            <UpcomingCard
              direction="pickup"
              reservations={dashboard.upcoming_pickups}
              viewAllHref="/reservations/manage?window=UPCOMING"
            />
          </div>

          <div className={`transition-opacity ${upcomingLoading ? "opacity-50" : ""}`}>
            <UpcomingCard
              direction="return"
              reservations={dashboard.upcoming_returns}
              viewAllHref="/reservations/manage?window=ACTIVE"
            />
          </div>
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
