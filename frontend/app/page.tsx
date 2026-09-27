"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, MapPinned, Wrench, X } from "lucide-react";

import {
  getDashboard,
  getLocations,
  getFleetStatus,
  type Dashboard,
  type Location,
  type FleetStatus,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { CarStatusBadge } from "@/components/ui/Badge";
import { UpcomingCard } from "@/components/dashboard/UpcomingCard";
import { getCarStatusHex } from "@/lib/status";
import { PieChart, type PieChartDatum } from "@/components/charts/PieChart";
import { Skeleton, SkeletonStatTiles } from "@/components/ui/Skeleton";
import { useNavigate } from "@/lib/useNavigate";
import { addDays, formatCalendarDate, todayInZone } from "@/lib/format";
import { enumLabel, t } from "@/lib/i18n";
import { categoryLabel } from "@/lib/carDisplay";

const FLEET_STATUS_ORDER: { key: string; label: string }[] = [
  { key: "available", get label() { return enumLabel("carStatus", "AVAILABLE"); } },
  { key: "reserved", get label() { return enumLabel("carStatus", "RESERVED"); } },
  { key: "rented", get label() { return enumLabel("carStatus", "RENTED"); } },
  { key: "maintenance", get label() { return enumLabel("carStatus", "MAINTENANCE"); } },
  { key: "cleaning", get label() { return enumLabel("carStatus", "CLEANING"); } },
];

/** Today's date at the business (not in UTC, not in the browser). */
function todayDateString() {
  return todayInZone();
}

/** This week's Mon–Sun as date-input values, so staff can jump straight
 * to any day in the current week instead of picking two dates by hand. */
function currentWeekDates(): { label: string; date: string }[] {
  const today = todayInZone();
  // Days are plain calendar dates, so the weekday is read in UTC.
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 (Sun) – 6 (Sat)
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, mondayOffset + index);

    return { label: formatCalendarDate(date, { weekday: "short" }), date };
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

  // The relocation list opens at the very top of the overview.
  const [showRelocation, setShowRelocation] = useState(false);

  const [fleetStatus, setFleetStatus] = useState<FleetStatus | null>(null);
  const [fleetStatusLoading, setFleetStatusLoading] = useState(true);
  const [fleetStatusError, setFleetStatusError] = useState("");

  // Narrows upcoming_pickups/upcoming_returns to a specific window —
  // defaults to today; "" on both is the "All upcoming" view, reachable
  // via its own button below.
  const [upcomingStartDate, setUpcomingStartDate] = useState(todayDateString());
  const [upcomingEndDate, setUpcomingEndDate] = useState(todayDateString());
  // Pickups are matched on their pickup airport, returns on their return
  // airport. "" means all airports.
  const [upcomingLocationId, setUpcomingLocationId] = useState("");
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [upcomingError, setUpcomingError] = useState("");
  const hasLoadedDashboardRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setUpcomingError("");

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
          locationId: upcomingLocationId || undefined,
        });

        if (!cancelled) {
          setDashboard(data);
          hasLoadedDashboardRef.current = true;
        }
      } catch {
        if (!cancelled) {
          // A failed range filter shouldn't blank the whole dashboard —
          // only the very first load has nothing else to fall back on.
          if (hasLoadedDashboardRef.current) {
            setUpcomingError(t("s.failedLoadPickupsReturns"));
          } else {
            setError(t("s.failedLoadDashboard"));
          }
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
  }, [upcomingStartDate, upcomingEndDate, upcomingLocationId]);

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

  // Follows the same date chosen for pickups/returns below (its start date;
  // "All upcoming" has no single date, so it falls back to today), rather
  // than a second date picker of its own — one choice of date drives the
  // whole overview.
  const fleetStatusDate = upcomingStartDate || todayDateString();

  useEffect(() => {
    let cancelled = false;

    async function loadFleetStatus() {
      setFleetStatusLoading(true);
      setFleetStatusError("");

      try {
        const data = await getFleetStatus({
          date: fleetStatusDate,
          locationId: airportFilter || undefined,
        });

        if (!cancelled) {
          setFleetStatus(data);
        }
      } catch {
        if (!cancelled) {
          setFleetStatusError(t("s.failedLoadFleetStatus"));
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
  }, [airportFilter, fleetStatusDate]);

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
            {error || t("s.failedLoadDashboard")}
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
          <h1 className="text-3xl font-bold tracking-tight text-ink">{t("s.overview")}</h1>

          <p className="mt-2 text-ink-secondary">{t("s.fleetReservationsAtGlance")}</p>
        </div>

        {/* Opened from the "Need relocation" tile; sits on top of the overview. */}
        {showRelocation && dashboard.cars_away_from_home.length > 0 && (
          <Card className="mb-8 border border-amber-300">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{t("s.vehiclesNeedRelocation")}</h2>

                <p className="mt-1 text-sm text-gray-500">{t("s.theseCarsEndedOne")}</p>
              </div>

              <button
                type="button"
                onClick={() => setShowRelocation(false)}
                aria-label={t("s.close")}
                className="rounded-md p-1 text-gray-500 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 divide-y divide-border-subtle">
              {dashboard.cars_away_from_home.map((car) => (
                <button
                  key={car.id}
                  type="button"
                  onClick={() => navigate(`/cars/${car.id}`)}
                  className="flex w-full flex-col gap-2 py-3 text-left transition hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900 md:flex-row md:items-center md:justify-between"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {car.make} {car.model}
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        {car.year}
                        {car.category ? ` · ${categoryLabel(car.category)}` : ""}
                      </span>
                    </span>

                    <span className="mt-0.5 block text-sm text-gray-500">
                      {car.license_plate}
                    </span>
                  </span>

                  <span className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
                    <span>{t("s.at")}{" "}<strong>{car.current_airport_code}</strong>{" "}
                      <span className="text-gray-500">
                        ({car.current_airport_name})
                      </span>
                    </span>

                    <span className="text-gray-400" aria-hidden="true">
                      →
                    </span>

                    <span>{t("s.home")}{" "}<strong>{car.home_airport_code}</strong>{" "}
                      <span className="text-gray-500">
                        ({car.home_airport_name})
                      </span>
                    </span>

                    <CarStatusBadge status={car.status} />

                    <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* Cars needing attention: in maintenance, and away from home. */}
        <section className="mb-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate("/maintenance")}
              className="flex items-center justify-between gap-4 rounded-xl bg-white p-6 text-left shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            >
              <div>
                <p className="text-sm text-gray-500">{t("s.dashboard.inMaintenance")}</p>

                <p className="mt-2 text-3xl font-bold">
                  {dashboard.fleet.maintenance}
                </p>

                <p className="mt-2 text-sm text-gray-500">{t("s.vehiclesOutServiceRight")}</p>
              </div>

              <Wrench className="h-6 w-6 shrink-0 text-gray-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setShowRelocation((open) => !open)}
              disabled={dashboard.cars_away_from_home.length === 0}
              aria-expanded={showRelocation}
              className="flex items-center justify-between gap-4 rounded-xl bg-white p-6 text-left shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 disabled:cursor-default disabled:hover:shadow-sm"
            >
              <div>
                <p className="text-sm text-gray-500">{t("s.needRelocation")}</p>

                <p className="mt-2 text-3xl font-bold">
                  {dashboard.cars_away_from_home.length}
                </p>

                <p className="mt-2 text-sm text-gray-500">
                  {dashboard.cars_away_from_home.length === 0
                    ? t("s.everyVehicleAtIts")
                    : t("s.vehiclesAwayFromTheir")}
                </p>
              </div>

              <MapPinned className="h-6 w-6 shrink-0 text-gray-400" aria-hidden="true" />
            </button>
          </div>
        </section>

        {/* Next pickups + Next returns */}
        <h2 className="mt-8 text-lg font-semibold text-ink">{t("s.pickupsReturns")}</h2>

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
            >{t("s.allUpcoming")}</button>

            {currentWeekDates().map(({ label, date }) => (
              <button
                key={date}
                type="button"
                onClick={() => {
                  setUpcomingStartDate(date);
                  setUpcomingEndDate(date);
                }}
                title={date === todayDateString() ? t("s.today", { label }) : label}
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
              aria-label={t("s.fromDate")}
              value={upcomingStartDate}
              onChange={(event) => {
                const value = event.target.value;
                setUpcomingStartDate(value);

                // The backend rejects start > end, so pushing the end
                // date forward keeps the range valid.
                if (value && upcomingEndDate && value > upcomingEndDate) {
                  setUpcomingEndDate(value);
                }
              }}
              className="rounded-lg border border-border-strong bg-white px-3 py-1.5 text-sm text-ink transition focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />

            <span className="text-ink-muted" aria-hidden="true">
              –
            </span>

            <input
              type="date"
              aria-label={t("s.date")}
              value={upcomingEndDate}
              onChange={(event) => {
                const value = event.target.value;
                setUpcomingEndDate(value);

                if (value && upcomingStartDate && value < upcomingStartDate) {
                  setUpcomingStartDate(value);
                }
              }}
              className="rounded-lg border border-border-strong bg-white px-3 py-1.5 text-sm text-ink transition focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />

            <select
              aria-label={t("s.filterPickupsReturnsBy")}
              value={upcomingLocationId}
              onChange={(event) => setUpcomingLocationId(event.target.value)}
              className="rounded-lg border border-border-strong bg-white px-3 py-1.5 text-sm text-ink transition focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              <option value="">{t("s.allAirports")}</option>

              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.airport_code}
                </option>
              ))}
            </select>

            {upcomingError && (
              <p className="text-sm text-red-600" role="alert">
                {upcomingError}
              </p>
            )}
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
                <h2 className="text-lg font-semibold">{t("s.fleetStatus")}</h2>
                <p className="mt-1 text-sm text-gray-500">{t("s.vehicleStatusAsSelected", { date: formatCalendarDate(fleetStatusDate) })}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  aria-label={t("s.filterFleetStatusBy")}
                  value={airportFilter}
                  onChange={(event) => setAirportFilter(event.target.value)}
                  className="rounded-lg border border-border-strong bg-white px-3 py-2 text-sm text-ink transition focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                >
                  <option value="">{t("s.allAirports")}</option>

                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.airport_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6">
              {fleetStatusLoading ? (
                <p className="text-sm text-gray-500">{t("s.loadingFleetStatus")}</p>
              ) : fleetStatusError ? (
                <p className="text-sm text-red-600">{fleetStatusError}</p>
              ) : (
                <PieChart data={pieData} />
              )}
            </div>
          </Card>

          {/* Fleet by location */}
          <Card>
            <h2 className="text-lg font-semibold">{t("s.fleetByLocation")}</h2>

            <p className="mt-1 text-sm text-gray-500">{t("s.currentVehicleDistribution")}</p>

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

                      <span className="rounded bg-gray-100 px-2 py-1 text-gray-700">{t("s.available", { available: location.available })}</span>

                      {location.reserved > 0 && (
                        <span className="rounded bg-gray-100 px-2 py-1 text-gray-700">{t("s.reserved", { reserved: location.reserved })}</span>
                      )}

                      {location.rented > 0 && (
                        <span className="rounded bg-gray-900 px-2 py-1 text-white">{t("s.rented", { rented: location.rented })}</span>
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
