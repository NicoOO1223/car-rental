"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, MapPin, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import {
  getCars,
  getFleetReservations,
  getFleetMaintenanceTasks,
  getCarStatusesByDate,
  type Car,
  type CarReservation,
  type FleetReservation,
  type FleetMaintenanceTask,
} from "@/lib/api";
import { getReservationStatusStyle } from "@/lib/status";
import { CarStatusBadge, ReservationStatusBadge } from "@/components/ui/Badge";
import { FleetVehicles } from "@/components/cars/FleetVehicles";
import { ScheduleHoverCard, type ScheduleHoverTarget } from "@/components/cars/ScheduleHoverCard";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { SubNav } from "@/components/ui/SubNav";
import { toDateKey } from "@/components/booking/DateRangeCalendar";
import { formatCalendarDate, formatDate, formatDateTime as formatMoment, formatTime, todayInZone } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { useUrlFilters } from "@/lib/useUrlFilters";
import { t, enumLabel } from "@/lib/i18n";
import { useUsesVehicleClasses } from "@/lib/vehicleClasses";
import { categoryLabel } from "@/lib/carDisplay";
import { classWords } from "@/lib/classDisplay";

// Only bookings that are actually confirmed or currently underway are
// operationally relevant to the fleet schedule — pending requests and
// completed/cancelled history would just clutter the timeline.
const VISIBLE_RESERVATION_STATUSES = new Set(["CONFIRMED", "ACTIVE"]);

type CarWithReservations = Car & {
  reservations: CarReservation[];
  tasks: FleetMaintenanceTask[];
};

// insured_until is a YYYY-MM-DD string — plain lexicographic comparison
// against today's date key works the same as parsing both to dates.
function isCurrentlyInsured(car: Car): boolean {
  return !!car.insured_until && car.insured_until >= todayInZone();
}

// One day's column, and the vehicle column that stays put while the days scroll.
const DAY_WIDTH = 84;
const LABEL_WIDTH = 232;
const ROW_HEIGHT = 60;

/**
 * How a vehicle's card looks right now: plain while it is free, tinted while it is
 * taken (reserved or out on a rental) or out of service. The status is also in the
 * dot's title and in text for screen readers, so the colour is never the only signal.
 * The edge is always 3px, so the text lines up from one row to the next.
 */
function cardTone(status: string): string {
  if (status === "MAINTENANCE" || status === "CLEANING") {
    return "border-l-[3px] border-l-warning-strong bg-warning-soft";
  }

  if (status === "RESERVED" || status === "RENTED") {
    return "border-l-[3px] border-l-accent bg-accent-soft";
  }

  return "border-l-[3px] border-l-transparent bg-surface";
}

/**
 * A booking bar's colours. Confirmed sits in the brand's soft tone (the same family
 * as a reserved vehicle's card), a rental under way is solid brand colour, and
 * anything else keeps the app-wide status colours.
 */
function barTone(status: string, variant: "bar" | "dot" = "bar"): string {
  if (status === "CONFIRMED") {
    return variant === "bar" ? "bg-accent-soft text-ink ring-1 ring-inset ring-accent/30" : "bg-accent-soft ring-1 ring-accent/50";
  }

  if (status === "ACTIVE") {
    return variant === "bar" ? "bg-accent text-on-accent" : "bg-accent";
  }

  return getReservationStatusStyle(status, variant === "bar" ? "subtle" : "dot");
}

/** The small dot in front of a vehicle's name. */
function statusDot(status: string): string {
  if (status === "MAINTENANCE" || status === "CLEANING") return "bg-warning-strong";
  if (status === "RESERVED" || status === "RENTED") return "bg-accent";

  return "bg-success-strong";
}

/** A date key moved by whole days, built from the parts so no zone can shift it. */
function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);

  return toDateKey(new Date(year, month - 1, day + days));
}

// Which view, and the All vehicles view's own choices. Kept in the address,
// so a link or a reload opens the page the way it was left.
const VIEW_DEFAULTS = { view: "vehicles", layout: "grid", location: "ALL", status: "ALL" };

export default function FleetPage() {
  const classesOn = useUsesVehicleClasses();
  const navigate = useNavigate();
  const { filters, setFilters } = useUrlFilters(VIEW_DEFAULTS);
  const view = filters.view === "schedule" ? "schedule" : "vehicles";
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
        // Three requests in total, however many cars there are (this used to
        // fetch each car's reservations separately).
        const [carData, fleetReservations, fleetTasks]: [
          Car[],
          FleetReservation[],
          FleetMaintenanceTask[],
        ] = await Promise.all([getCars(), getFleetReservations(), getFleetMaintenanceTasks()]);

        const byCar = new Map<string, FleetReservation[]>();

        for (const reservation of fleetReservations) {
          const list = byCar.get(reservation.car_id) ?? [];
          list.push(reservation);
          byCar.set(reservation.car_id, list);
        }

        const tasksByCar = new Map<string, FleetMaintenanceTask[]>();

        for (const task of fleetTasks) {
          const list = tasksByCar.get(task.car_id) ?? [];
          list.push(task);
          tasksByCar.set(task.car_id, list);
        }

        setCars(
          carData.map((car) => ({
            ...car,
            reservations: byCar.get(car.id) ?? [],
            tasks: tasksByCar.get(car.id) ?? [],
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
        setError(t("s.cars.failedLoadFleetData"));
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

  const todayKey = todayInZone();

  const timelineEnd = useMemo(() => {
    const date = new Date(timelineStart);
    date.setDate(timelineStart.getDate() + timelineDaysCount);
    return date;
  }, [timelineStart, timelineDaysCount]);

  const gridRef = useRef<HTMLDivElement>(null);

  // The booking under the pointer, drawn by ScheduleHoverCard outside the frame.
  const [hover, setHover] = useState<ScheduleHoverTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // The card is placed from where the bar is on screen, so anything that moves the
  // bar takes the card away rather than leaving it behind.
  useEffect(() => {
    if (!hover) return;

    const clear = () => setHover(null);
    const frame = gridRef.current;

    frame?.addEventListener("scroll", clear, { passive: true });
    window.addEventListener("scroll", clear, { passive: true });
    window.addEventListener("resize", clear);

    return () => {
      frame?.removeEventListener("scroll", clear);
      window.removeEventListener("scroll", clear);
      window.removeEventListener("resize", clear);
    };
  }, [hover]);

  function showHover(element: HTMLElement, reservation: CarReservation) {
    const box = element.getBoundingClientRect();
    const frame = gridRef.current?.getBoundingClientRect();
    // Only the part of the bar that is on screen: beside the vehicle column, inside the frame.
    const left = Math.max(box.left, (frame?.left ?? 0) + LABEL_WIDTH);
    const right = Math.min(box.right, frame?.right ?? window.innerWidth);

    setHover({
      left,
      right: Math.max(left, right),
      top: box.top,
      bottom: box.bottom,
      name: `${reservation.customer.first_name} ${reservation.customer.last_name}`,
      phone: reservation.customer.phone_number,
      email: reservation.customer.email,
      when: `${formatDateTime(reservation.pickup_at, reservation.pickup_location.timezone)} → ${formatDateTime(
        reservation.return_at,
        reservation.return_location.timezone,
      )}`,
    });
  }

  function toggleLocation(code: string) {
    setCollapsed((current) => {
      const next = new Set(current);

      if (next.has(code)) next.delete(code);
      else next.add(code);

      return next;
    });
  }

  // The schedule scrolls inside its own frame, so the airport header rows can stay
  // under the top edge however many vehicles a location has. The frame takes what
  // is left of the window below the controls.
  useEffect(() => {
    if (view !== "schedule" || loading) return;

    function fit() {
      const frame = gridRef.current;

      if (!frame) return;

      const top = frame.getBoundingClientRect().top + window.scrollY;

      frame.style.maxHeight = `${Math.max(360, window.innerHeight - top - 40)}px`;
    }

    fit();
    window.addEventListener("resize", fit);

    return () => window.removeEventListener("resize", fit);
  }, [view, loading, error]);

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

    // Grouped by home airport, not where the car happens to be right now —
    // a one-way rental shouldn't make a car vanish from its usual fleet
    // panel. is_away_from_home (below) flags it there instead.
    for (const car of filteredCars) {
      const airportCode = car.home_location.airport_code;
      if (!groups.has(airportCode)) {
        groups.set(airportCode, {
          name: car.home_location.name,
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

  // Mirrors getReservationPosition, for a task's own start/end instead of a
  // reservation's pickup/return. A task and a reservation on the same car
  // never overlap in time (the backend's conflict check guarantees it), so
  // both can safely share the same row.
  function getTaskPosition(start: Date, end: Date) {
    const startOffset = Math.max(0, getDayDifference(timelineStart, start));
    const endOffset = Math.min(
      timelineDaysCount,
      getDayDifference(timelineStart, end)
    );

    const width = Math.max(0.5, endOffset - startOffset);

    return {
      left: startOffset * DAY_WIDTH,
      width: width * DAY_WIDTH,
    };
  }

  function getVisibleTasks(car: CarWithReservations) {
    return car.tasks
      .map((task) => ({
        task,
        start: new Date(task.starts_at ?? task.opened_at),
        end: task.ends_at ? new Date(task.ends_at) : timelineEnd,
      }))
      .filter(({ start, end }) => start < timelineEnd && end > timelineStart);
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
        <div className="max-w-md rounded-2xl border border-border-subtle bg-surface p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft mb-4">
            <span className="text-danger text-xl">!</span>
          </div>
          <p className="text-ink font-semibold text-lg">{t("s.cars.whoops")}</p>
          <p className="text-ink-muted mt-2">{error}</p>
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
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t("s.cars.fleetOverview")}</h1>
            <p className="mt-1.5 text-sm text-ink-secondary sm:text-base">
              {view === "schedule" ? t("s.cars.eachVehicleSStatus") : t("s.cars.allVehiclesIntro")}
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto">
            {/* Search Box */}
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                placeholder={t("s.cars.searchMakeModelPlate")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border-strong bg-surface py-2.5 pl-10 pr-4 text-sm text-ink transition placeholder:text-ink-muted focus:border-accent-ink focus:outline-none focus:ring-2 focus:ring-accent-ink"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
            </div>

            {view === "schedule" && (
              <>
              {/* Move the window: back a week, to today, forward a week */}
              <div className="flex items-center gap-1 rounded-2xl border border-border-subtle bg-surface p-1 ring-1 ring-inset ring-border-strong">
                <button
                  type="button"
                  onClick={() => setStartDate((current) => shiftDateKey(current, -7))}
                  aria-label={t("s.cars.scheduleBackWeek")}
                  title={t("s.cars.scheduleBackWeek")}
                  className="rounded-lg p-1.5 text-ink-secondary transition hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => setStartDate(todayInZone())}
                  className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-secondary transition hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                >
                  {t("s.cars.scheduleToday")}
                </button>

                <button
                  type="button"
                  onClick={() => setStartDate((current) => shiftDateKey(current, 7))}
                  aria-label={t("s.cars.scheduleForwardWeek")}
                  title={t("s.cars.scheduleForwardWeek")}
                  className="rounded-lg p-1.5 text-ink-secondary transition hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {/* Date Range Selectors */}
              <div className="flex w-full items-center gap-2 rounded-2xl border border-border-subtle bg-surface p-1 ring-1 ring-inset ring-border-strong sm:w-auto">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border-0 bg-transparent px-3 py-1.5 text-sm text-ink-secondary outline-none focus:ring-2 focus:ring-accent-ink sm:flex-none"
                />
                <div className="h-4 w-px bg-border-strong" />
                <select
                  value={timelineDaysCount}
                  onChange={(e) => setTimelineDaysCount(Number(e.target.value))}
                  className="cursor-pointer rounded-lg border-0 bg-transparent px-3 py-1.5 text-sm text-ink-secondary outline-none focus:ring-2 focus:ring-accent-ink"
                >
                  <option value={7}>{t("s.cars.1Week")}</option>
                  <option value={14}>{t("s.cars.2Weeks")}</option>
                  <option value={30}>{t("s.cars.1Month")}</option>
                  <option value={60}>{t("s.cars.2Months")}</option>
                </select>
              </div>
              </>
            )}
          </div>
        </div>

        <SubNav
          className="mb-5"
          label={t("s.cars.fleetOverview")}
          activeId={view}
          onSelect={(id) => setFilters({ view: id })}
          items={[
            { id: "vehicles", label: t("s.cars.viewVehicles"), count: cars.length },
            { id: "schedule", label: t("s.cars.viewSchedule") },
          ]}
        />

        {view === "vehicles" && (
          <FleetVehicles
            cars={cars.filter((car) => {
              const query = searchQuery.toLowerCase();

              return (
                car.make.toLowerCase().includes(query) ||
                car.model.toLowerCase().includes(query) ||
                car.license_plate.toLowerCase().includes(query)
              );
            })}
            statusOf={(car) => statusByDate[car.id] ?? car.status}
            filters={filters}
            onFiltersChange={setFilters}
            onOpen={(car) => navigate(`/cars/${car.id}`)}
            searching={searchQuery !== ""}
          />
        )}

        {view === "schedule" && (
          <>
        {/* Legend */}
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs font-medium text-ink-secondary">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${barTone("CONFIRMED", "dot")}`} />{t("s.cars.confirmed")}</div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${barTone("ACTIVE", "dot")}`} />{t("s.cars.active")}</div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full border border-warning-line bg-warning-soft" />{t("s.cars.maintenanceOrCleaning")}</div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />{t("s.cars.insured")}</div>
          <p className="text-ink-muted">{t("s.cars.pendingCompletedCancelledReservations")}</p>
        </div>

        {/* Phones: one card list per airport, its header kept under the top bar. The
            day-by-day grid below needs room to scroll sideways, so it is not used here. */}
        <div className="space-y-6 lg:hidden">
          {carsByLocation.map((location) => (
            <section key={location.airportCode} className="overflow-clip rounded-2xl border border-border-subtle bg-surface">
              <div className="sticky top-[3.8rem] z-20 flex items-center gap-3 border-b border-border-subtle bg-canvas px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-sm font-bold tracking-tight text-ink">
                  {location.airportCode}
                </div>

                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-ink">{location.name}</h2>
                  <p className="text-xs text-ink-muted">{t("common.vehicles", { count: location.cars.length })}</p>
                </div>
              </div>

              <div className="divide-y divide-border-subtle">
                {location.cars.map((car) => {
                  const reservations = getVisibleReservations(car).sort(
                    (a, b) =>
                      new Date(a.pickup_at).getTime() -
                      new Date(b.pickup_at).getTime(),
                  );
                  const tasks = getVisibleTasks(car).sort(
                    (a, b) => a.start.getTime() - b.start.getTime(),
                  );
                  const displayStatus = getDisplayStatus(car);

                  return (
                    <div key={car.id} className={`p-4 ${cardTone(displayStatus)}`}>
                      <button
                        type="button"
                        onClick={() => navigate(`/cars/${car.id}`)}
                        className="flex w-full items-start justify-between gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                      >
                        <div>
                          <p className="flex items-center gap-1.5 font-bold text-ink">
                            {car.make} {car.model}
                            {isCurrentlyInsured(car) && (
                              <span
                                title={t("s.cars.insuredUntil", { date: car.insured_until ? formatDate(car.insured_until) : "" })}
                              >
                                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 inline-block rounded-md bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-muted">
                            {car.license_plate}
                          </p>
                          {car.is_away_from_home && (
                            <p className="ml-2 inline-flex items-center gap-1 rounded-md bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                              {t("s.cars.awayHome", { airport_code: car.current_location.airport_code })}
                            </p>
                          )}
                          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
                            <span>{car.year}</span>
                            <span className="h-1 w-1 rounded-full bg-border-strong" />
                            <span>
                              {classesOn && car.vehicle_class
                                ? classWords(car.vehicle_class.name)
                                : car.category
                                  ? categoryLabel(car.category)
                                  : t("s.cars.standard")}
                            </span>
                          </p>
                        </div>

                        <CarStatusBadge
                          status={displayStatus}
                          className="shrink-0"
                        />
                      </button>

                      <div className="mt-3 space-y-1.5">
                        {reservations.length === 0 && tasks.length === 0 ? (
                          <p className="text-xs text-ink-muted">{t("s.cars.noBookingsRange")}</p>
                        ) : (
                          <>
                            {reservations.map((reservation) => (
                              <button
                                key={reservation.id}
                                onClick={() =>
                                  navigate(`/reservations/manage/${reservation.id}`)
                                }
                                className="block w-full rounded-lg bg-canvas px-3 py-2 text-left transition hover:bg-surface-sunken"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-medium text-ink">
                                    {reservation.customer.first_name}{" "}
                                    {reservation.customer.last_name}
                                  </span>

                                  <ReservationStatusBadge
                                    status={reservation.status}
                                    className="shrink-0"
                                  />
                                </div>

                                <p className="mt-1 text-xs text-ink-muted">
                                  {formatDateTime(reservation.pickup_at, reservation.pickup_location.timezone)} →{" "}
                                  {formatDateTime(reservation.return_at, reservation.return_location.timezone)}
                                </p>
                              </button>
                            ))}

                            {tasks.map(({ task, start, end }) => (
                              <button
                                key={task.id}
                                onClick={() => navigate(`/cars/${car.id}`)}
                                className="block w-full rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-left text-warning transition hover:bg-warning-line"
                              >
                                <span className="truncate text-sm font-medium">
                                  {task.task_type === "CLEANING" ? t("s.cars.id.cleaning") : t("s.cars.id.maintenance")}
                                </span>

                                <p className="mt-1 text-xs opacity-90">
                                  {formatDateTime(start.toISOString())} →{" "}
                                  {task.ends_at ? formatDateTime(end.toISOString()) : t("s.cars.id.untilClosed")}
                                </p>
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Desktop: the schedule scrolls inside this frame. Each airport's bar (its name,
            then the days) stays under the top edge while its vehicles are in view and is
            pushed away by the next airport's own. The vehicle column stays put when the
            days scroll sideways. */}
        {carsByLocation.length > 0 && (
          <div
            ref={gridRef}
            role="region"
            aria-label={t("s.cars.viewSchedule")}
            tabIndex={0}
            className="hidden overflow-auto overscroll-contain rounded-xl border border-border-subtle bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink lg:block"
          >
            <div style={{ width: LABEL_WIDTH + timelineDaysCount * DAY_WIDTH }}>
              {carsByLocation.map((location, index) => {
                const isCollapsed = collapsed.has(location.airportCode);

                return (
                  <section key={location.airportCode} id={location.airportCode}>
                    {/* A band of page background between one airport and the next */}
                    {index > 0 && <div className="h-4 border-y border-border-subtle bg-canvas" aria-hidden="true" />}

                    {/* Airport bar: name on the left, then every day of the range */}
                    <div className="sticky top-0 z-30 flex border-b border-border-subtle bg-surface">
                      <div
                        className="sticky left-0 z-40 flex shrink-0 items-center gap-2 bg-surface px-3"
                        style={{ width: LABEL_WIDTH, height: 40 }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleLocation(location.airportCode)}
                          aria-expanded={!isCollapsed}
                          aria-label={isCollapsed ? t("s.cars.scheduleExpand") : t("s.cars.scheduleCollapse")}
                          title={isCollapsed ? t("s.cars.scheduleExpand") : t("s.cars.scheduleCollapse")}
                          className="rounded-md p-1 text-ink-muted transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                            aria-hidden="true"
                          />
                        </button>

                        <h2 className="flex min-w-0 items-baseline gap-2">
                          <span className="text-sm font-bold tracking-wide text-ink">{location.airportCode}</span>
                          <span className="truncate text-xs text-ink-muted">{location.name}</span>
                        </h2>

                        <span className="ml-auto shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                          {location.cars.length}
                        </span>
                      </div>

                      <div className="flex">
                        {timelineDays.map((date, dayIndex) => {
                          const key = toDateKey(date);
                          const isToday = key === todayKey;
                          const weekend = date.getDay() === 0 || date.getDay() === 6;
                          const showMonth = dayIndex === 0 || date.getDate() === 1;

                          return (
                            <div
                              key={dayIndex}
                              style={{ width: DAY_WIDTH, height: 40 }}
                              className="flex shrink-0 items-end justify-center"
                            >
                              <span
                                className={`flex items-baseline gap-1 border-b-2 px-1 pb-1.5 text-xs ${
                                  isToday
                                    ? "border-accent font-semibold text-ink"
                                    : `border-transparent ${weekend ? "text-ink-muted/70" : "text-ink-muted"}`
                                }`}
                              >
                                <span className="uppercase">{formatCalendarDate(key, { weekday: "short" })}</span>
                                <span className={`text-sm font-semibold ${isToday ? "" : "text-ink-secondary"}`}>
                                  {date.getDate()}
                                </span>
                                {showMonth && (
                                  <span className="text-[10px] uppercase">{formatCalendarDate(key, { month: "short" })}</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Vehicle rows */}
                    {!isCollapsed &&
                      location.cars.map((car) => {
                        const reservations = getVisibleReservations(car);
                        const tasks = getVisibleTasks(car);
                        const displayStatus = getDisplayStatus(car);

                        return (
                          <div key={car.id} className="group/row flex border-b border-border-subtle last:border-b-0">
                            {/* Vehicle (stays at the left edge) */}
                            <button
                              type="button"
                              onClick={() => navigate(`/cars/${car.id}`)}
                              style={{ width: LABEL_WIDTH }}
                              className={`group sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-0.5 px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ink ${cardTone(displayStatus)}`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  className={`h-2 w-2 shrink-0 rounded-full ${statusDot(displayStatus)}`}
                                  title={
                                    displayStatus !== car.status
                                      ? `${enumLabel("carStatus", displayStatus)} (${t("s.cars.liveStatus", { status: enumLabel("carStatus", car.status) })})`
                                      : enumLabel("carStatus", displayStatus)
                                  }
                                />
                                <span className="sr-only">{enumLabel("carStatus", displayStatus)}</span>

                                <span className="truncate text-sm font-semibold text-ink group-hover:underline">
                                  {car.make} {car.model}
                                </span>

                                {isCurrentlyInsured(car) && (
                                  <span title={t("s.cars.insuredUntil", { date: car.insured_until ? formatDate(car.insured_until) : "" })}>
                                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                                  </span>
                                )}
                              </span>

                              <span className="flex min-w-0 items-center gap-1.5 pl-4 text-xs text-ink-muted">
                                <span className="shrink-0 font-mono">{car.license_plate}</span>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">
                                  {classesOn && car.vehicle_class
                                    ? classWords(car.vehicle_class.name)
                                    : car.category
                                      ? categoryLabel(car.category)
                                      : t("s.cars.standard")}
                                </span>

                                {car.is_away_from_home && (
                                  <span
                                    className="ml-auto flex shrink-0 items-center gap-0.5 font-medium text-warning"
                                    title={t("s.cars.awayHome", { airport_code: car.current_location.airport_code })}
                                  >
                                    <MapPin className="h-3 w-3" aria-hidden="true" />
                                    <span>{car.current_location.airport_code}</span>
                                  </span>
                                )}
                              </span>
                            </button>

                            {/* The days: weekend shading, a line at each Monday, the today line, then the bookings */}
                            <div
                              className="relative shrink-0"
                              style={{ width: timelineDaysCount * DAY_WIDTH, minHeight: ROW_HEIGHT }}
                            >
                              <div className="pointer-events-none absolute inset-0 flex">
                                {timelineDays.map((date, dayIndex) => {
                                  const weekend = date.getDay() === 0 || date.getDay() === 6;

                                  return (
                                    <div
                                      key={dayIndex}
                                      style={{ width: DAY_WIDTH }}
                                      className={`shrink-0 ${weekend ? "bg-surface-sunken/50" : ""} ${
                                        date.getDay() === 1 ? "border-l border-border-subtle" : ""
                                      }`}
                                    />
                                  );
                                })}
                              </div>

                              {timelineDays.some((date) => toDateKey(date) === todayKey) && (
                                <div
                                  className="pointer-events-none absolute bottom-0 top-0 z-[5] border-l border-accent"
                                  style={{ left: Math.max(0, getDayDifference(timelineStart, new Date())) * DAY_WIDTH }}
                                />
                              )}

                              {/* Bookings: slim bars. The details are in the card that follows the pointer. */}
                              {reservations.map((reservation) => {
                                const position = getReservationPosition(reservation);

                                return (
                                  <div
                                    key={reservation.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => navigate(`/reservations/manage/${reservation.id}`)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        navigate(`/reservations/manage/${reservation.id}`);
                                      }
                                    }}
                                    onMouseEnter={(event) => showHover(event.currentTarget, reservation)}
                                    onMouseLeave={() => setHover(null)}
                                    onFocus={(event) => showHover(event.currentTarget, reservation)}
                                    onBlur={() => setHover(null)}
                                    className={`absolute top-1/2 z-10 flex h-11 -translate-y-1/2 cursor-pointer flex-col justify-center overflow-hidden rounded-lg px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${barTone(reservation.status)}`}
                                    style={{ left: position.left + 2, width: Math.max(position.width - 4, 10) }}
                                  >
                                    <span className="truncate text-[13px] font-semibold leading-tight">
                                      {reservation.customer.first_name} {reservation.customer.last_name}
                                    </span>

                                    <span className="truncate text-[11px] tabular-nums leading-tight opacity-75">
                                      {formatTime(reservation.pickup_at, reservation.pickup_location.timezone)} –{" "}
                                      {formatTime(reservation.return_at, reservation.return_location.timezone)}
                                    </span>
                                  </div>
                                );
                              })}

                              {/* Maintenance / cleaning windows */}
                              {tasks.map(({ task, start, end }) => {
                                const position = getTaskPosition(start, end);
                                const label = task.task_type === "CLEANING" ? t("s.cars.id.cleaning") : t("s.cars.id.maintenance");
                                const Icon = task.task_type === "CLEANING" ? Sparkles : Wrench;

                                return (
                                  <div
                                    key={task.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => navigate(`/cars/${car.id}`)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        navigate(`/cars/${car.id}`);
                                      }
                                    }}
                                    className="absolute top-1/2 z-10 flex h-11 -translate-y-1/2 cursor-pointer flex-col justify-center overflow-hidden rounded-lg border border-warning-line bg-warning-soft px-2.5 text-xs text-warning outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                                    style={{ left: position.left + 2, width: Math.max(position.width - 4, 10) }}
                                    title={`${label} — ${formatDateTime(start.toISOString())} → ${
                                      task.ends_at ? formatDateTime(end.toISOString()) : t("s.cars.id.untilClosed")
                                    }${task.notes ? ` — ${task.notes}` : ""}`}
                                  >
                                    <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight">
                                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                      <span className="truncate">{label}</span>
                                    </span>

                                    <span className="truncate text-[11px] leading-tight opacity-80">
                                      {task.notes || t("s.cars.id.outService2")}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {hover && (
          <ScheduleHoverCard target={hover} noPhone={t("s.cars.noPhoneFile")} noEmail={t("s.cars.noEmailFile")} />
        )}

        {/* Empty Search / Fleet State */}
        {carsByLocation.length === 0 && !loading && (
          <div className="mt-8 rounded-2xl border border-border-subtle bg-surface p-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-canvas mb-4">
              <svg className="h-8 w-8 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p className="text-xl font-bold text-ink">{t("s.cars.noVehiclesFound")}</p>
            <p className="mt-2 text-sm text-ink-muted max-w-sm mx-auto">
              {searchQuery
                ? t("s.cars.noVehiclesMatchedSearch", { searchQuery })
                : t("s.cars.thereCurrentlyNoVehicles")}
            </p>
          </div>
        )}
          </>
        )}
      </div>
    </main>
  );
}
