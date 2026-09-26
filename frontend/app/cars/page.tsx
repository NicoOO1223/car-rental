"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, Phone } from "lucide-react";
import {
  getCars,
  getFleetReservations,
  getCarStatusesByDate,
  type Car,
  type CarReservation,
  type FleetReservation,
} from "@/lib/api";
import { getCarStatusStyle, getReservationStatusStyle } from "@/lib/status";
import { CarStatusBadge, ReservationStatusBadge } from "@/components/ui/Badge";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { toDateKey } from "@/components/booking/DateRangeCalendar";
import { formatCalendarDate, formatDateTime as formatMoment, formatTime, todayInZone } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";

// Only bookings that are actually confirmed or currently underway are
// operationally relevant to the fleet schedule — pending requests and
// completed/cancelled history would just clutter the timeline.
const VISIBLE_RESERVATION_STATUSES = new Set(["CONFIRMED", "ACTIVE"]);

type CarWithReservations = Car & {
  reservations: CarReservation[];
};

const DAY_WIDTH = 100; // Slightly wider for better readability

export default function FleetPage() {
  const navigate = useNavigate();
  const [cars, setCars] = useState<CarWithReservations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New Control States
  // The timeline opens on today at the business, not in UTC or the browser.
  const [startDate, setStartDate] = useState<string>(() => todayInZone());
  const [timelineDaysCount, setTimelineDaysCount] = useState<number>(30);
  const [searchQuery, setSearchQuery] = useState("");

  // Status "as of" the selected date — derived from CONFIRMED/ACTIVE
  // reservations, not each car's raw (undated) status field. Falls back
  // to that raw status per-car until this loads, or if it fails.
  const [statusByDate, setStatusByDate] = useState<Record<string, string>>(
    {},
  );

  /*
   * ---------------------------------------------------------
   * Load fleet
   * ---------------------------------------------------------
   */
  useEffect(() => {
    async function loadFleet() {
      try {
        // Two requests in total, however many cars there are (this used to
        // fetch each car's reservations separately).
        const [carData, fleetReservations]: [Car[], FleetReservation[]] =
          await Promise.all([getCars(), getFleetReservations()]);

        const byCar = new Map<string, FleetReservation[]>();

        for (const reservation of fleetReservations) {
          const list = byCar.get(reservation.car_id) ?? [];
          list.push(reservation);
          byCar.set(reservation.car_id, list);
        }

        setCars(
          carData.map((car) => ({
            ...car,
            reservations: byCar.get(car.id) ?? [],
          })),
        );

        // A link like /cars#CAG only auto-scrolls if that element already
        // exists when the browser processes the URL — since this content
        // loads after a fetch, do it ourselves once it's actually there.
        if (window.location.hash) {
          const target = document.getElementById(
            window.location.hash.slice(1),
          );
          target?.scrollIntoView({ block: "start" });
        }
      } catch {
        setError("Failed to load fleet data. Please try again later.");
      } finally {
        setLoading(false);
      }
    }
    loadFleet();
  }, []);

  /*
   * ---------------------------------------------------------
   * Status as of the selected date
   * ---------------------------------------------------------
   */
  useEffect(() => {
    let cancelled = false;

    async function loadStatusByDate() {
      try {
        const data = await getCarStatusesByDate(startDate);

        if (!cancelled) {
          setStatusByDate(data);
        }
      } catch {
        // Non-fatal — badges just fall back to each car's raw status.
      }
    }

    loadStatusByDate();

    return () => {
      cancelled = true;
    };
  }, [startDate]);

  function getDisplayStatus(car: CarWithReservations) {
    return statusByDate[car.id] ?? car.status;
  }

  /*
   * ---------------------------------------------------------
   * Timeline Calculation (Dynamic based on controls)
   * ---------------------------------------------------------
   */
  const timelineStart = useMemo(() => {
    // Built from the year, month and day directly: parsing "2040-06-15" as a
    // Date reads it as UTC midnight, which is the previous evening for
    // anyone west of Greenwich.
    const [year, month, day] = startDate.split("-").map(Number);
    return new Date(year, month - 1, day);
  }, [startDate]);

  const timelineDays = useMemo(() => {
    return Array.from({ length: timelineDaysCount }, (_, index) => {
      const date = new Date(timelineStart);
      date.setDate(timelineStart.getDate() + index);
      return date;
    });
  }, [timelineStart, timelineDaysCount]);

  const timelineEnd = useMemo(() => {
    const date = new Date(timelineStart);
    date.setDate(timelineStart.getDate() + timelineDaysCount);
    return date;
  }, [timelineStart, timelineDaysCount]);

  /*
   * ---------------------------------------------------------
   * Filter & Group cars by airport
   * ---------------------------------------------------------
   */
  const carsByLocation = useMemo(() => {
    const groups = new Map<
      string,
      {
        name: string;
        airportCode: string;
        cars: CarWithReservations[];
      }
    >();

    // Apply Search Filter
    const filteredCars = cars.filter((car) => {
      const query = searchQuery.toLowerCase();
      return (
        car.make.toLowerCase().includes(query) ||
        car.model.toLowerCase().includes(query) ||
        car.license_plate.toLowerCase().includes(query)
      );
    });

    for (const car of filteredCars) {
      const airportCode = car.current_location.airport_code;
      if (!groups.has(airportCode)) {
        groups.set(airportCode, {
          name: car.current_location.name,
          airportCode,
          cars: [],
        });
      }
      groups.get(airportCode)!.cars.push(car);
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.airportCode.localeCompare(b.airportCode)
    );
  }, [cars, searchQuery]);

  /*
   * ---------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------
   */
  // A rental's pickup and return are shown at the clocks of the places
  // they happen at.
  function formatDateTime(date: string, timeZone?: string) {
    return formatMoment(date, timeZone);
  }

  function getReservationStyles(status: string) {
    return `shadow-sm border border-black/5 ${getReservationStatusStyle(status, "subtle")}`;
  }

  function getStatusClass(status: string) {
    return getCarStatusStyle(status);
  }

  function getDayDifference(start: Date, end: Date) {
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  }

  function getReservationPosition(reservation: CarReservation) {
    const pickup = new Date(reservation.pickup_at);
    const returnDate = new Date(reservation.return_at);

    const startOffset = Math.max(0, getDayDifference(timelineStart, pickup));
    const endOffset = Math.min(
      timelineDaysCount,
      getDayDifference(timelineStart, returnDate)
    );

    const width = Math.max(0.5, endOffset - startOffset);

    return {
      left: startOffset * DAY_WIDTH,
      width: width * DAY_WIDTH,
    };
  }

  function getVisibleReservations(car: CarWithReservations) {
    return car.reservations.filter((reservation) => {
      if (!VISIBLE_RESERVATION_STATUSES.has(reservation.status)) return false;
      const pickup = new Date(reservation.pickup_at);
      const returnDate = new Date(reservation.return_at);
      return pickup < timelineEnd && returnDate > timelineStart;
    });
  }

  /*
   * ---------------------------------------------------------
   * Loading / Error States
   * ---------------------------------------------------------
   */
  if (loading) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          <Skeleton className="mb-8 h-9 w-64" />
          <SkeletonRows count={6} />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-canvas p-4 sm:p-6 lg:p-8">
        <div className="rounded-xl bg-surface p-8 text-center shadow-sm max-w-md">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mb-4">
            <span className="text-red-600 text-xl">!</span>
          </div>
          <p className="text-gray-900 font-semibold text-lg">Whoops!</p>
          <p className="text-gray-500 mt-2">{error}</p>
        </div>
      </main>
    );
  }

  /*
   * ---------------------------------------------------------
   * Main Page Render
   * ---------------------------------------------------------
   */
  return (
    <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1800px]">
        {/* Header & Controls */}
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-ink">
              Fleet Overview
            </h1>
            <p className="mt-2 text-gray-500">
              Each vehicle&apos;s status reflects the selected date, not just right now.
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto">
            {/* Search Box */}
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                placeholder="Search make, model, plate..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border-strong bg-white py-2.5 pl-10 pr-4 text-sm text-ink transition placeholder:text-ink-muted focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
            </div>

            {/* Date Range Selectors */}
            <div className="flex w-full items-center gap-2 rounded-xl bg-white p-1 shadow-sm ring-1 ring-inset ring-gray-300 sm:w-auto">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border-0 bg-transparent px-3 py-1.5 text-sm text-ink-secondary outline-none focus:ring-2 focus:ring-gray-900 sm:flex-none"
              />
              <div className="h-4 w-px bg-gray-300" />
              <select
                value={timelineDaysCount}
                onChange={(e) => setTimelineDaysCount(Number(e.target.value))}
                className="cursor-pointer rounded-lg border-0 bg-transparent px-3 py-1.5 text-sm text-ink-secondary outline-none focus:ring-2 focus:ring-gray-900"
              >
                <option value={7}>1 Week</option>
                <option value={14}>2 Weeks</option>
                <option value={30}>1 Month</option>
                <option value={60}>2 Months</option>
              </select>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mb-6 flex flex-wrap items-center gap-6 rounded-xl bg-surface px-6 py-3 text-sm font-medium text-ink-secondary shadow-sm">
          <div className="flex items-center gap-2.5">
            <span className={`h-3 w-3 rounded-full ring-2 ring-gray-100 ${getReservationStatusStyle("CONFIRMED", "dot")}`} />
            Confirmed
          </div>
          <div className="flex items-center gap-2.5">
            <span className={`h-3 w-3 rounded-full ring-2 ring-gray-100 ${getReservationStatusStyle("ACTIVE", "dot")}`} />
            Active
          </div>
          <p className="text-xs text-gray-400">
            Pending, completed, and cancelled reservations aren&apos;t shown here.
          </p>
        </div>

        {/* Fleet Locations */}
        <div className="space-y-8">
          {carsByLocation.map((location) => (
            <section
              key={location.airportCode}
              id={location.airportCode}
              className="overflow-hidden rounded-xl bg-surface shadow-sm scroll-mt-6"
            >
              {/* Airport Header */}
              <div className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white px-6 py-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-900 font-bold tracking-tight">
                    {location.airportCode}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-gray-900">
                      {location.name}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {location.cars.length} vehicle{location.cars.length !== 1 && "s"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Mobile: card list — the Gantt timeline below is a fixed
                  day-by-day grid that only makes sense with room to scroll
                  sideways, so narrow screens get a simpler per-vehicle list
                  instead, driven by the same date-range filter. */}
              <div className="divide-y divide-gray-100 lg:hidden">
                {location.cars.map((car) => {
                  const reservations = getVisibleReservations(car).sort(
                    (a, b) =>
                      new Date(a.pickup_at).getTime() -
                      new Date(b.pickup_at).getTime(),
                  );
                  const displayStatus = getDisplayStatus(car);

                  return (
                    <div key={car.id} className="p-4">
                      <button
                        type="button"
                        onClick={() => navigate(`/cars/${car.id}`)}
                        className="flex w-full items-start justify-between gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                      >
                        <div>
                          <p className="font-bold text-gray-900">
                            {car.make} {car.model}
                          </p>
                          <p className="mt-0.5 inline-block rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                            {car.license_plate}
                          </p>
                          {car.is_away_from_home && (
                            <p className="ml-2 inline-block rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              Away · home {car.home_location.airport_code}
                            </p>
                          )}
                          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-400">
                            <span>{car.year}</span>
                            <span className="h-1 w-1 rounded-full bg-gray-300" />
                            <span>{car.category || "Standard"}</span>
                          </p>
                        </div>

                        <CarStatusBadge
                          status={displayStatus}
                          className="shrink-0"
                        />
                      </button>

                      <div className="mt-3 space-y-1.5">
                        {reservations.length === 0 ? (
                          <p className="text-xs text-gray-400">
                            No bookings in this range
                          </p>
                        ) : (
                          reservations.map((reservation) => (
                            <button
                              key={reservation.id}
                              onClick={() =>
                                navigate(`/reservations/manage/${reservation.id}`)
                              }
                              className="block w-full rounded-lg bg-gray-50 px-3 py-2 text-left transition hover:bg-gray-100"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium text-gray-900">
                                  {reservation.customer.first_name}{" "}
                                  {reservation.customer.last_name}
                                </span>

                                <ReservationStatusBadge
                                  status={reservation.status}
                                  className="shrink-0"
                                />
                              </div>

                              <p className="mt-1 text-xs text-gray-500">
                                {formatDateTime(reservation.pickup_at, reservation.pickup_location.timezone)} →{" "}
                                {formatDateTime(reservation.return_at, reservation.return_location.timezone)}
                              </p>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop: Gantt-style schedule timeline */}
              <div className="hidden overflow-x-auto lg:block">
                <div
                  style={{
                    minWidth: 320 + timelineDaysCount * DAY_WIDTH,
                  }}
                  className="pb-2"
                >
                  {/* Timeline Dates Header */}
                  <div className="flex border-b border-gray-100 bg-gray-50/50">
                    <div className="w-[320px] shrink-0 border-r border-gray-100 px-6 py-4 sticky left-0 bg-gray-50/95 backdrop-blur z-30">
                      <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                        Vehicle Details
                      </p>
                    </div>

                    <div className="flex">
                      {timelineDays.map((date, index) => {
                        const isToday = toDateKey(date) === todayInZone();
                        return (
                          <div
                            key={index}
                            style={{ width: DAY_WIDTH }}
                            className={`shrink-0 border-r border-gray-100 px-2 py-3 flex flex-col items-center justify-center ${
                              isToday ? "bg-gray-100" : ""
                            }`}
                          >
                            <p className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? 'text-gray-900' : 'text-gray-400'}`}>
                              {formatCalendarDate(toDateKey(date), { weekday: "short" })}
                            </p>
                            <p className={`mt-0.5 text-lg font-bold ${isToday ? 'text-gray-900' : 'text-gray-700'}`}>
                              {date.getDate()}
                            </p>
                            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                              {formatCalendarDate(toDateKey(date), { month: "short" })}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Vehicle Rows */}
                  {location.cars.map((car) => {
                    const reservations = getVisibleReservations(car);
                    const displayStatus = getDisplayStatus(car);

                    return (
                      <div
                        key={car.id}
                        className="group flex border-b border-gray-50 last:border-b-0 hover:bg-gray-50/50 transition-colors"
                      >
                        {/* Vehicle Information (Sticky Left) */}
                        <button
                          type="button"
                          onClick={() => navigate(`/cars/${car.id}`)}
                          className="sticky left-0 z-30 w-[320px] shrink-0 border-r border-gray-100 bg-white px-6 py-5 text-left transition-colors group-hover:bg-gray-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900"
                        >
                          <div className="flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-bold text-gray-900 group-hover:underline transition-colors">
                                  {car.make} {car.model}
                                </p>
                                <p className="mt-0.5 text-xs font-medium text-gray-500 bg-gray-100 inline-block px-2 py-0.5 rounded-md">
                                  {car.license_plate}
                                </p>
                              </div>
                              <span
                                title={
                                  displayStatus !== car.status
                                    ? `Live status: ${car.status}`
                                    : undefined
                                }
                                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusClass(
                                  displayStatus
                                )}`}
                              >
                                {displayStatus}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400 flex items-center gap-1.5">
                              <span>{car.year}</span>
                              <span className="w-1 h-1 rounded-full bg-gray-300" />
                              <span>{car.category || "Standard"}</span>
                            </p>
                          </div>
                        </button>

                        {/* Timeline Grid & Reservations */}
                        <div
                          className="relative shrink-0"
                          style={{
                            width: timelineDaysCount * DAY_WIDTH,
                            minHeight: 100,
                          }}
                        >
                          {/* Grid Columns */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {timelineDays.map((date, index) => {
                              const isToday =
                                date.toDateString() === new Date().toDateString();
                              return (
                                <div
                                  key={index}
                                  style={{ width: DAY_WIDTH }}
                                  className={`shrink-0 border-r border-gray-100/50 ${
                                    isToday ? "bg-gray-100/40" : ""
                                  }`}
                                />
                              );
                            })}
                          </div>

                          {/* Today Line Indicator */}
                          {timelineDays.some(
                            (d) => d.toDateString() === new Date().toDateString()
                          ) && (
                            <div
                              className="absolute bottom-0 top-0 z-10 border-l-2 border-dashed border-gray-900 pointer-events-none"
                              style={{
                                left:
                                  Math.max(
                                    0,
                                    getDayDifference(timelineStart, new Date())
                                  ) * DAY_WIDTH,
                              }}
                            >
                               <div className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-gray-900 ring-4 ring-white" />
                            </div>
                          )}

                          {/* Reservation Blocks */}
                          {reservations.map((reservation) => {
                            const position = getReservationPosition(reservation);

                            return (
                              // Outer wrapper only positions the block and
                              // scopes the hover/focus tooltip below — it
                              // must not clip overflow itself, since the
                              // tooltip needs to render outside the card's
                              // own bounds.
                              <div
                                key={reservation.id}
                                className="group/res absolute top-1/2 z-20 -translate-y-1/2 hover:z-30 focus-within:z-30"
                                style={{
                                  left: position.left + 4, // 4px gap for breathability
                                  width: position.width - 8,
                                }}
                              >
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() =>
                                    navigate(`/reservations/manage/${reservation.id}`)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      navigate(`/reservations/manage/${reservation.id}`);
                                    }
                                  }}
                                  className={`flex h-16 cursor-pointer flex-col justify-center overflow-hidden rounded-xl px-3 outline-none transition-all hover:scale-[1.02] focus-visible:scale-[1.02] focus-visible:ring-2 focus-visible:ring-gray-900 ${getReservationStyles(
                                    reservation.status
                                  )}`}
                                >
                                  <p className="truncate text-sm font-bold">
                                    {reservation.customer.first_name}{" "}
                                    {reservation.customer.last_name}
                                  </p>
                                  <p className="truncate text-[11px] font-medium opacity-80 mt-0.5">
                                    {formatTime(reservation.pickup_at, reservation.pickup_location.timezone)} - {formatTime(reservation.return_at, reservation.return_location.timezone)}
                                  </p>
                                </div>

                                {/* Hover/focus tooltip: customer contact details */}
                                <div className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2.5 hidden w-60 -translate-x-1/2 flex-col gap-2 rounded-lg bg-gray-900 px-3.5 py-3 text-xs text-white shadow-lg group-hover/res:flex group-focus-within/res:flex">
                                  <p className="truncate text-sm font-bold">
                                    {reservation.customer.first_name}{" "}
                                    {reservation.customer.last_name}
                                  </p>

                                  <div className="space-y-1.5 border-t border-white/10 pt-2">
                                    <p className="flex items-center gap-2 text-gray-300">
                                      <Phone className="h-3 w-3 shrink-0" />
                                      <span className="truncate">
                                        {reservation.customer.phone_number ||
                                          "No phone on file"}
                                      </span>
                                    </p>
                                    <p className="flex items-center gap-2 text-gray-300">
                                      <Mail className="h-3 w-3 shrink-0" />
                                      <span className="truncate">
                                        {reservation.customer.email ||
                                          "No email on file"}
                                      </span>
                                    </p>
                                  </div>

                                  <p className="border-t border-white/10 pt-2 text-gray-400">
                                    {formatDateTime(reservation.pickup_at, reservation.pickup_location.timezone)} →{" "}
                                    {formatDateTime(reservation.return_at, reservation.return_location.timezone)}
                                  </p>

                                  <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-gray-900" />
                                </div>
                              </div>
                            );
                          })}

                          {/* Free State Text (Optional) */}
                          {reservations.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <span className="rounded-full bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-400">
                                No bookings
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* Empty Search / Fleet State */}
        {carsByLocation.length === 0 && !loading && (
          <div className="mt-8 rounded-xl bg-surface p-10 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-50 mb-4">
              <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p className="text-xl font-bold text-gray-900">
              No vehicles found
            </p>
            <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">
              {searchQuery
                ? `No vehicles matched your search "${searchQuery}". Try adjusting your filters.`
                : "There are currently no vehicles registered in the fleet."}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}