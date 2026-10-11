"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, Wrench } from "lucide-react";

import {
  cancelMaintenanceTask,
  completeMaintenanceTask,
  getCar,
  getCarMaintenanceTasks,
  getCarReservations,
  returnCarToHome,
  getLocations,
  type Car,
  type CarReservation,
  type Location,
  type MaintenanceTask,
} from "@/lib/api";
import { getReservationStatusStyle } from "@/lib/status";
import { CarStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CarEditModal } from "@/components/cars/CarEditModal";
import { VehicleConditionModal } from "@/components/cars/VehicleConditionModal";
import { CompleteTaskModal } from "@/components/maintenance/CompleteTaskModal";
import { NewTaskModal } from "@/components/maintenance/NewTaskModal";
import { inspectionStatus, maintenanceCategoryLabel } from "@/lib/maintenance";
import { SkeletonDetailPage } from "@/components/ui/Skeleton";
import {
  formatCalendarDate,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  todayInZone,
} from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { can } from "@/lib/permissions";
import { t, enumLabel } from "@/lib/i18n";
import { categoryLabel } from "@/lib/carDisplay";
import { classWords } from "@/lib/classDisplay";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

// Longer ranges get narrower day columns so they stay scannable; at the
// narrowest widths the date header collapses to just the day number.
const TIMELINE_RANGES = [
  { days: 30, get label() { return t("duration.days", { count: 30 }); }, dayWidth: 90 },
  { days: 60, get label() { return t("duration.days", { count: 60 }); }, dayWidth: 60 },
  { days: 90, get label() { return t("duration.days", { count: 90 }); }, dayWidth: 40 },
  { days: 180, get label() { return t("duration.months", { count: 6 }); }, dayWidth: 24 },
  { days: 365, get label() { return t("duration.years", { count: 1 }); }, dayWidth: 16 },
] as const;

/** A calendar-day Date (local midnight) back to "YYYY-MM-DD". */
function dateKey(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export default function CarDetailsPage({ params }: Props) {
  const navigate = useNavigate();
  // Whether this account may change things; the server refuses the rest anyway.
  const { user: currentUser } = useCurrentUser();
  const canWrite = can(currentUser?.role, "bookings.write");
  const [car, setCar] = useState<Car | null>(null);
  const [reservations, setReservations] = useState<
    CarReservation[]
  >([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [maintenanceTasks, setMaintenanceTasks] = useState<MaintenanceTask[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editingCondition, setEditingCondition] = useState(false);
  const [loggingTask, setLoggingTask] = useState(false);
  const [timelineRangeDays, setTimelineRangeDays] = useState<number>(30);
  const [relocating, setRelocating] = useState(false);
  const [relocateError, setRelocateError] = useState("");
  const [completingTask, setCompletingTask] = useState<MaintenanceTask | null>(
    null,
  );

  useEffect(() => {
    async function loadData() {
      try {
        const { id } = await params;

        const [carData, reservationData, locationData, taskData] =
          await Promise.all([
            getCar(id),
            getCarReservations(id),
            getLocations(),
            getCarMaintenanceTasks(id),
          ]);

        setCar(carData);
        setReservations(reservationData);
        setLocations(locationData);
        setMaintenanceTasks(taskData);
      } catch {
        setError(t("s.cars.id.failedLoadVehicle"));
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [params]);


  async function handleCompleteTask(task: MaintenanceTask) {
    // An inspection records itself on the car and needs its next due
    // date, so it goes through a form first.
    if (task.category === "TECHNICAL_INSPECTION") {
      setCompletingTask(task);
      return;
    }

    await handleTaskCompleted(await completeMaintenanceTask(task.id));
  }

  async function handleTaskCompleted(updated: MaintenanceTask) {
    setMaintenanceTasks((tasks) =>
      tasks.map((task) => (task.id === updated.id ? updated : task)),
    );

    // Refetch: closing an inspection also updates the car's inspection
    // dates, not just its status.
    setCar(await getCar(updated.car.id));
  }

  async function handleReturnToHome() {
    if (!car) return;

    const confirmed = window.confirm(
      t("s.cars.id.confirmCarNowAt", { airport_code: car.home_location.airport_code }),
    );

    if (!confirmed) return;

    setRelocating(true);
    setRelocateError("");

    try {
      setCar(await returnCarToHome(car.id));
    } catch (err) {
      setRelocateError(
        err instanceof Error ? err.message : t("s.cars.id.failedMoveCar"),
      );
    } finally {
      setRelocating(false);
    }
  }

  async function handleCancelTask(taskId: string) {
    const updated = await cancelMaintenanceTask(taskId);

    setMaintenanceTasks((tasks) =>
      tasks.map((task) => (task.id === updated.id ? updated : task)),
    );

    if (car) {
      setCar({ ...car, status: "AVAILABLE" });
    }
  }

  // A request, or an approved booking whose advance has not come: not settled yet, so
  // an outline. Amber stays for out of service, the one thing it means here.
  function getReservationClass(status: string) {
    if (status === "PENDING" || status === "AWAITING_PAYMENT") {
      return "border border-dashed border-border-strong bg-surface text-ink-secondary";
    }

    return getReservationStatusStyle(status, "solid");
  }

  const timelineRange =
    TIMELINE_RANGES.find((range) => range.days === timelineRangeDays) ??
    TIMELINE_RANGES[0];
  const TIMELINE_DAYS: number = timelineRange.days;
  const DAY_WIDTH: number = timelineRange.dayWidth;
  const compactHeader = DAY_WIDTH < 40;

  /*
   * Timeline starts today and covers the selected range (30 days by
   * default).
   */
  const timelineStart = useMemo(() => {
    // Today at the business, as a plain calendar day.
    const [year, month, day] = todayInZone().split("-").map(Number);

    return new Date(year, month - 1, day);
  }, []);

  const timelineDays = useMemo(() => {
    return Array.from(
      { length: TIMELINE_DAYS },
      (_, index) => {
        const date = new Date(timelineStart);

        date.setDate(
          timelineStart.getDate() + index
        );

        return date;
      }
    );
  }, [timelineStart, TIMELINE_DAYS]);

  function getDayDifference(
    start: Date,
    end: Date
  ) {
    const millisecondsPerDay =
      1000 * 60 * 60 * 24;

    return (
      (end.getTime() - start.getTime()) /
      millisecondsPerDay
    );
  }

  function getReservationPosition(
    reservation: CarReservation
  ) {
    const pickup = new Date(
      reservation.pickup_at
    );

    const returnDate = new Date(
      reservation.return_at
    );

    const startOffset = Math.max(
      0,
      getDayDifference(
        timelineStart,
        pickup
      )
    );

    const endOffset = Math.min(
      TIMELINE_DAYS,
      getDayDifference(
        timelineStart,
        returnDate
      )
    );

    const width =
      Math.max(1, endOffset - startOffset);

    return {
      left: startOffset * DAY_WIDTH,
      width: width * DAY_WIDTH,
    };
  }

  /*
   * Only show reservations that intersect
   * the current 30-day timeline.
   */
  const visibleReservations = reservations.filter(
    (reservation) => {
      const pickup = new Date(
        reservation.pickup_at
      );

      const returnDate = new Date(
        reservation.return_at
      );

      const timelineEnd = new Date(
        timelineStart
      );

      timelineEnd.setDate(
        timelineStart.getDate() +
          TIMELINE_DAYS
      );

      return (
        pickup < timelineEnd &&
        returnDate > timelineStart
      );
    }
  );

  /*
   * Maintenance windows share the schedule. Cancelled tasks never took the
   * car out of service; a task closed early stops where it was closed; an
   * open-ended (older) task runs to the end of the timeline.
   */
  const timelineEnd = new Date(timelineStart);
  timelineEnd.setDate(timelineStart.getDate() + TIMELINE_DAYS);

  const visibleTasks = maintenanceTasks
    .filter((task) => task.status !== "CANCELLED")
    .map((task) => {
      const start = new Date(task.starts_at ?? task.opened_at);
      let end = task.ends_at ? new Date(task.ends_at) : timelineEnd;

      if (task.completed_at && new Date(task.completed_at) < end) {
        end = new Date(task.completed_at);
      }

      return { task, start, end };
    })
    .filter(({ start, end }) => start < timelineEnd && end > timelineStart);

  function getTaskPosition(start: Date, end: Date) {
    const startOffset = Math.max(0, getDayDifference(timelineStart, start));
    const endOffset = Math.min(
      TIMELINE_DAYS,
      getDayDifference(timelineStart, end),
    );

    return {
      left: startOffset * DAY_WIDTH,
      width: Math.max(0.5, endOffset - startOffset) * DAY_WIDTH,
    };
  }

  /*
   * Rows: bookings and service windows share a row unless they would overlap on
   * screen (a short booking is drawn at least a day wide, so two on the same day
   * collide). Each item takes the first row where it fits, which keeps the
   * schedule as short as it can be and adds a row only for a real overlap.
   */
  const timelineItems = [
    ...visibleReservations.map((reservation) => ({
      key: `r:${reservation.id}`,
      ...getReservationPosition(reservation),
    })),
    ...visibleTasks.map(({ task, start, end }) => ({
      key: `t:${task.id}`,
      ...getTaskPosition(start, end),
    })),
  ].sort((a, b) => a.left - b.left || b.width - a.width);

  const rowEnds: number[] = [];
  const rowOf = new Map<string, number>();

  for (const item of timelineItems) {
    let row = rowEnds.findIndex((end) => end <= item.left + 0.5);

    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(0);
    }

    rowEnds[row] = item.left + item.width;
    rowOf.set(item.key, row);
  }

  const timelineRowCount = rowEnds.length;

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <SkeletonDetailPage />
      </main>
    );
  }

  if (error || !car) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-danger">
            {error || t("s.cars.id.vehicleNotFound")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div className="mb-8">

          <button
            onClick={() =>
              navigate("/cars")
            }
            className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />{t("s.cars.id.backFleet")}</button>

          <div className="mt-4 flex items-center justify-between">

            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                {car.make} {car.model}
              </h1>

              <p className="mt-2 text-ink-muted">
                {car.license_plate}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <CarStatusBadge status={car.status} className="px-4 py-2 text-sm" />

              <Button variant="secondary" onClick={() => setEditing(true)} disabled={!canWrite}>
                <Pencil className="h-4 w-4" />{t("s.cars.id.edit")}</Button>
            </div>

          </div>
        </div>

        {car.is_away_from_home && (
          <div
            className="mb-6 flex flex-col gap-3 rounded-xl border border-warning-line bg-warning-soft p-4 text-warning sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <div>
              <p className="font-medium">{t("s.cars.id.awayFromHomeAirport")}</p>

              <p className="mt-1 text-sm">{t("s.cars.id.carAtButBelongs", { airport_code: car.current_location.airport_code, airport_code2: car.home_location.airport_code })}</p>

              {relocateError && (
                <p className="mt-2 text-sm text-danger">{relocateError}</p>
              )}
            </div>

            <Button
              variant="secondary"
              onClick={handleReturnToHome}
              disabled={relocating || !canWrite}
            >
              {relocating
                ? t("s.cars.id.saving")
                : t("s.cars.id.return", { airport_code: car.home_location.airport_code })}
            </Button>
          </div>
        )}

        {/* Vehicle information */}
        <section className="rounded-2xl border border-border-subtle bg-surface p-6">

          <h2 className="text-xl font-semibold">{t("s.cars.id.vehicleInformation")}</h2>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.licensePlate")}</p>

              <p className="mt-1 font-medium">
                {car.license_plate}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.year")}</p>

              <p className="mt-1 font-medium">
                {car.year}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.class")}</p>

              <p className="mt-1 font-medium">{car.vehicle_class ? classWords(car.vehicle_class.name) : t("s.cars.id.noClass")}</p>

              {car.vehicle_class && <p className="text-xs text-ink-muted">{t("s.cars.id.pricedByClass")}</p>}
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.category")}</p>

              <p className="mt-1 font-medium">
                {car.category ? categoryLabel(car.category) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.priceDay")}</p>

              <p className="mt-1 font-medium">
                {formatCurrency(car.price_per_day)}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.transmission")}</p>

              <p className="mt-1 font-medium">
                {car.transmission ? enumLabel("transmission", car.transmission) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.fuel")}</p>

              <p className="mt-1 font-medium">
                {car.fuel_type ? enumLabel("fuel", car.fuel_type) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.seats")}</p>

              <p className="mt-1 font-medium">
                {car.seats ?? "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.currentLocation")}</p>

              <p className="mt-1 font-medium">
                {car.current_location.airport_code}
              </p>

              <p className="text-sm text-ink-muted">
                {car.current_location.name}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.homeAirport")}</p>

              <p className="mt-1 font-medium">
                {car.home_location.airport_code}
              </p>

              <p className="text-sm text-ink-muted">
                {car.home_location.name}
              </p>
            </div>

          </div>
        </section>

        {/* Vehicle condition */}
        <section className="mt-6 rounded-2xl border border-border-subtle bg-surface p-6">

          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{t("s.cars.id.vehicleCondition")}</h2>

            <Button variant="secondary" onClick={() => setEditingCondition(true)} disabled={!canWrite}>
              <Pencil className="h-4 w-4" />{t("s.cars.id.edit")}</Button>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.mileage")}</p>

              <p className="mt-1 font-medium">
                {car.mileage != null ? t("common.km", { value: formatNumber(car.mileage) }) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.tireCondition")}</p>

              <p className="mt-1 font-medium">
                {car.tire_condition ? enumLabel("tireCondition", car.tire_condition) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.lastOilChange")}</p>

              <p className="mt-1 font-medium">
                {car.last_oil_change_at ? formatDate(car.last_oil_change_at) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.lastInspection")}</p>

              <p className="mt-1 font-medium">
                {car.last_inspection_at ? formatDate(car.last_inspection_at) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.nextInspectionDue")}</p>

              <p className="mt-1 font-medium">
                {car.next_inspection_due ? formatDate(car.next_inspection_due) : "—"}
                {inspectionStatus(car.next_inspection_due) === "overdue" && (
                  <span className="ml-2 rounded bg-danger-soft px-1.5 py-0.5 text-xs font-medium text-danger">{t("s.cars.id.overdue")}</span>
                )}
                {inspectionStatus(car.next_inspection_due) === "soon" && (
                  <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">{t("s.cars.id.dueSoon")}</span>
                )}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.insuredSince")}</p>

              <p className="mt-1 font-medium">
                {car.insured_from ? formatDate(car.insured_from) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.insuredUntil")}</p>

              <p className="mt-1 font-medium">
                {car.insured_until ? formatDate(car.insured_until) : "—"}
                {inspectionStatus(car.insured_until) === "overdue" && (
                  <span className="ml-2 rounded bg-danger-soft px-1.5 py-0.5 text-xs font-medium text-danger">{t("s.cars.id.expired")}</span>
                )}
                {inspectionStatus(car.insured_until) === "soon" && (
                  <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">{t("s.cars.id.endsSoon")}</span>
                )}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.cars.id.insuranceCost")}</p>

              <p className="mt-1 font-medium">
                {car.insurance_cost != null ? formatCurrency(car.insurance_cost) : "—"}
              </p>
            </div>

          </div>
        </section>

        {/* Maintenance history */}
        <section className="mt-6 rounded-2xl border border-border-subtle bg-surface p-6">

          <div className="flex items-center justify-between">

            <div>
              <h2 className="text-xl font-semibold">{t("s.cars.id.maintenanceHistory")}</h2>

              <p className="mt-1 text-sm text-ink-muted">{t("s.cars.id.maintenanceCleaningTasksLogged")}</p>
            </div>

            <Button variant="secondary" onClick={() => setLoggingTask(true)} disabled={!canWrite}>
              <Wrench className="h-4 w-4" />{t("s.cars.id.logTask")}</Button>

          </div>

          {maintenanceTasks.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium text-ink-secondary">{t("s.cars.id.noMaintenanceHistory")}</p>

              <p className="mt-1 text-sm text-ink-muted">{t("s.cars.id.nothingHasBeenLogged")}</p>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {maintenanceTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <CarStatusBadge status={task.task_type} />

                    <div>
                      <p className="text-sm font-medium">
                        {task.category && (
                          <span className="mr-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-secondary">
                            {maintenanceCategoryLabel(task.category)}
                          </span>
                        )}
                        {task.notes || t("s.cars.id.noNotes")}
                      </p>

                      <p className="mt-0.5 text-xs text-ink-muted">{task.ends_at
                          ? t("s.cars.id.outServiceRange", {
                              from: formatDateTime(task.starts_at ?? task.opened_at),
                              to: formatDateTime(task.ends_at),
                            })
                          : t("s.cars.id.outServiceOpen", { from: formatDateTime(task.starts_at ?? task.opened_at) })}
                        {task.completed_at && (
                          <>{" "}{t("s.cars.id.closed", { date: formatDateTime(task.completed_at) })}</>
                        )}
                        {task.cost != null && <>{" · "}{t("s.cars.id.taskCost", { cost: formatCurrency(task.cost) })}</>}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-start sm:self-auto">
                    <span className="text-xs font-medium text-ink-muted">
                      {enumLabel("taskStatus", task.status)}
                    </span>

                    {task.status === "OPEN" && (
                      <>
                        <button
                          onClick={() => handleCompleteTask(task)}
                          className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                        >{t("s.cars.id.markComplete")}</button>

                        <button
                          onClick={() => handleCancelTask(task.id)}
                          className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                        >{t("s.cars.id.cancel")}</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Availability timeline */}
        <section className="mt-6 rounded-2xl border border-border-subtle bg-surface p-6">

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

            <div>
              <h2 className="text-xl font-semibold">{t("s.cars.id.availabilitySchedule")}</h2>

              <p className="mt-1 text-sm text-ink-muted">{t("s.cars.id.next", { label: timelineRange.label })}</p>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-surface-sunken p-1 text-sm">
              {TIMELINE_RANGES.map((range) => (
                <button
                  key={range.days}
                  type="button"
                  onClick={() => setTimelineRangeDays(range.days)}
                  aria-pressed={range.days === timelineRangeDays}
                  className={`rounded-md px-3 py-1 font-medium transition ${
                    range.days === timelineRangeDays
                      ? "bg-surface text-ink shadow-sm"
                      : "text-ink-secondary hover:text-ink"
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>

            <div className="flex gap-4 text-sm">

              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${getReservationStatusStyle("CONFIRMED", "dot")}`}
                />{t("s.cars.id.reserved")}</div>

              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${getReservationStatusStyle("ACTIVE", "dot")}`}
                />{t("s.cars.id.active")}</div>

              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${getReservationStatusStyle("COMPLETED", "dot")}`}
                />{t("s.cars.id.completed")}</div>

              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full border border-dashed border-ink-muted bg-surface" />{t("s.cars.id.notConfirmed")}</div>

              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-warning-strong" />{t("s.cars.id.outService2")}</div>

            </div>

          </div>

          {/* Timeline */}
          <div className="mt-6 overflow-x-auto">

            <div
              style={{
                width:
                  TIMELINE_DAYS * DAY_WIDTH,
              }}
            >

              {/* Date headers */}
              <div className="flex border-b">

                {timelineDays.map(
                  (date, index) => (
                    <div
                      key={index}
                      style={{
                        width: DAY_WIDTH,
                      }}
                      className={`shrink-0 border-r pb-3 ${
                        compactHeader ? "px-0 text-center" : "px-2"
                      }`}
                    >

                      {compactHeader ? (
                        <>
                          <p className="h-4 overflow-visible whitespace-nowrap text-left text-[10px] font-medium text-ink-muted">
                            {index === 0 || date.getDate() === 1
                              ? formatCalendarDate(dateKey(date), {
                                  month: "short",
                                })
                              : ""}
                          </p>

                          <p className="mt-1 text-[10px] font-medium">
                            {date.getDate()}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-ink-muted">
                            {formatCalendarDate(dateKey(date), {
                              weekday: "short",
                            })}
                          </p>

                          <p className="mt-1 font-medium">
                            {date.getDate()}
                          </p>

                          <p className="text-xs text-ink-muted">
                            {formatCalendarDate(dateKey(date), {
                              month: "short",
                            })}
                          </p>
                        </>
                      )}

                    </div>
                  )
                )}

              </div>

              {/* Schedule row */}
              <div
                className="relative mt-4"
                style={{
                  height:
                    Math.max(
                      90,
                      timelineRowCount *
                        70 +
                        20
                    ),
                }}
              >

                {/* Grid */}
                <div className="absolute inset-0 flex">

                  {timelineDays.map(
                    (_, index) => (
                      <div
                        key={index}
                        style={{
                          width: DAY_WIDTH,
                        }}
                        className="shrink-0 border-r border-border-subtle"
                      />
                    )
                  )}

                </div>

                {/* Today marker */}
                <div
                  className="absolute bottom-0 top-0 border-l-2 border-dashed border-accent"
                  style={{
                    left: 0,
                  }}
                />

                {/* Reservations */}
                {visibleReservations.map(
                  (reservation) => {

                    const position =
                      getReservationPosition(
                        reservation
                      );

                    return (
                      <div
                        key={reservation.id}
                        onClick={() =>
                          navigate(`/reservations/manage/${reservation.id}`)
                        }
                        className={`absolute flex cursor-pointer items-center overflow-hidden rounded-lg px-3 shadow-sm ${getReservationClass(
                          reservation.status
                        )}`}
                        style={{
                          left:
                            position.left,
                          width:
                            position.width,
                          top:
                            (rowOf.get(`r:${reservation.id}`) ?? 0) * 70 + 10,
                          height: 50,
                        }}
                        title={`${reservation.customer.first_name} ${reservation.customer.last_name} — ${formatDateTime(
                          reservation.pickup_at, reservation.pickup_location.timezone
                        )} → ${formatDateTime(
                          reservation.return_at, reservation.return_location.timezone
                        )}`}
                      >

                        <div className="min-w-0">

                          <p className="truncate text-sm font-semibold">
                            {
                              reservation
                                .customer
                                .first_name
                            }{" "}
                            {
                              reservation
                                .customer
                                .last_name
                            }
                          </p>

                          <p className="truncate text-xs opacity-90">
                            {formatDate(
                              reservation.pickup_at, reservation.pickup_location.timezone
                            )}
                            {" → "}
                            {formatDate(
                              reservation.return_at, reservation.return_location.timezone
                            )}
                          </p>

                        </div>

                      </div>
                    );
                  }
                )}

                {/* Maintenance / cleaning windows */}
                {visibleTasks.map(({ task, start, end }) => {
                  const position = getTaskPosition(start, end);

                  return (
                    <div
                      key={task.id}
                      className="absolute flex items-center overflow-hidden rounded-lg border border-warning-line bg-warning-soft px-3 text-warning shadow-sm"
                      style={{
                        left: position.left,
                        width: position.width,
                        top: (rowOf.get(`t:${task.id}`) ?? 0) * 70 + 10,
                        height: 50,
                      }}
                      title={`${enumLabel("taskType", task.task_type)} — ${formatDateTime(
                        start.toISOString()
                      )} → ${
                        task.ends_at
                          ? formatDateTime(end.toISOString())
                          : t("s.cars.id.untilClosed")
                      }${task.notes ? ` — ${task.notes}` : ""}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {task.task_type === "CLEANING" ? t("s.cars.id.cleaning") : t("s.cars.id.maintenance")}
                        </p>

                        <p className="truncate text-xs opacity-90">
                          {task.notes || t("s.cars.id.outService2")}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Available indicator */}
                {timelineRowCount ===
                  0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-lg bg-surface-sunken px-6 py-3 text-sm font-medium text-ink-secondary">{t("s.cars.id.vehicleAvailableNoReservations")}</div>
                  </div>
                )}

              </div>

            </div>

          </div>

          <p className="mt-4 text-xs text-ink-muted">{t("s.cars.id.scrollHorizontallyViewFull")}</p>

        </section>

        {/* Reservation details */}
        <section className="mt-6 rounded-2xl border border-border-subtle bg-surface p-6">

          <div className="flex items-center justify-between">

            <div>
              <h2 className="text-xl font-semibold">{t("s.cars.id.reservations")}</h2>

              <p className="mt-1 text-sm text-ink-muted">{t("s.cars.id.detailedBookingInformation")}</p>
            </div>

            <span className="text-sm text-ink-muted">{t("common.bookings", { count: reservations.length })}</span>

          </div>

          {reservations.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed p-8 text-center">

              <p className="font-medium text-ink-secondary">{t("s.cars.id.noReservations")}</p>

              <p className="mt-1 text-sm text-ink-muted">{t("s.cars.id.vehicleHasNoBookings")}</p>

            </div>
          ) : (
            <div className="mt-6 space-y-3">

              {reservations.map(
                (reservation) => (

                  <div
                    key={reservation.id}
                    onClick={() =>
                      navigate(`/reservations/manage/${reservation.id}`)
                    }
                    className="cursor-pointer rounded-lg border p-4 hover:bg-canvas"
                  >

                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

                      <div>
                        <p className="font-semibold">
                          {
                            reservation.customer
                              .first_name
                          }{" "}
                          {
                            reservation.customer
                              .last_name
                          }
                        </p>

                        <p className="mt-1 text-sm text-ink-muted">
                          {
                            reservation
                              .pickup_location
                              .airport_code
                          }
                          {" → "}
                          {
                            reservation
                              .return_location
                              .airport_code
                          }
                        </p>
                      </div>

                      <div className="md:text-right">

                        <p className="font-medium">
                          {formatDate(
                            reservation.pickup_at, reservation.pickup_location.timezone
                          )}
                          {" → "}
                          {formatDate(
                            reservation.return_at, reservation.return_location.timezone
                          )}
                        </p>

                        <p className="mt-1 text-sm text-ink-muted">
                          {formatDateTime(
                            reservation.pickup_at, reservation.pickup_location.timezone
                          )}
                          {" → "}
                          {formatDateTime(
                            reservation.return_at, reservation.return_location.timezone
                          )}
                        </p>

                      </div>

                      <span
                        className={`self-start rounded-full px-3 py-1 text-xs font-medium md:self-auto ${getReservationClass(
                          reservation.status
                        )}`}
                      >
                        {enumLabel("reservationStatus", reservation.status)}
                      </span>

                    </div>

                  </div>

                )
              )}

            </div>
          )}

        </section>

      </div>

      {editing && (
        <CarEditModal
          car={car}
          locations={locations}
          onClose={() => setEditing(false)}
          onSaved={(updated) => setCar(updated)}
        />
      )}

      {editingCondition && (
        <VehicleConditionModal
          car={car}
          onClose={() => setEditingCondition(false)}
          onSaved={(updated) => setCar(updated)}
        />
      )}

      {completingTask && (
        <CompleteTaskModal
          task={completingTask}
          onClose={() => setCompletingTask(null)}
          onCompleted={handleTaskCompleted}
        />
      )}

      {loggingTask && (
        <NewTaskModal
          car={car}
          onClose={() => setLoggingTask(false)}
          onCreated={(task) => {
            setMaintenanceTasks((tasks) => [task, ...tasks]);
            setCar({ ...car, status: task.task_type });
          }}
        />
      )}
    </main>
  );
}