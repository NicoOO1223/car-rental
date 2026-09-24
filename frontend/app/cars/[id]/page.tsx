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
import { formatCurrency } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

// Longer ranges get narrower day columns so they stay scannable; at the
// narrowest widths the date header collapses to just the day number.
const TIMELINE_RANGES = [
  { days: 30, label: "30 days", dayWidth: 90 },
  { days: 60, label: "60 days", dayWidth: 60 },
  { days: 90, label: "90 days", dayWidth: 40 },
  { days: 180, label: "6 months", dayWidth: 24 },
  { days: 365, label: "1 year", dayWidth: 16 },
] as const;

export default function CarDetailsPage({ params }: Props) {
  const navigate = useNavigate();
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
        setError("Failed to load vehicle.");
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
      `Confirm the car is now at its home airport, ${car.home_location.airport_code}?`,
    );

    if (!confirmed) return;

    setRelocating(true);
    setRelocateError("");

    try {
      setCar(await returnCarToHome(car.id));
    } catch (err) {
      setRelocateError(
        err instanceof Error ? err.message : "Failed to move the car.",
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

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString();
  }

  function formatDateTime(date: string) {
    return new Date(date).toLocaleString();
  }

  function getReservationClass(status: string) {
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
    const date = new Date();

    date.setHours(0, 0, 0, 0);

    return date;
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

  const timelineRowCount = visibleReservations.length + visibleTasks.length;

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
          <p className="text-red-600">
            {error || "Vehicle not found."}
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
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to fleet
          </button>

          <div className="mt-4 flex items-center justify-between">

            <div>
              <h1 className="text-3xl font-bold">
                {car.make} {car.model}
              </h1>

              <p className="mt-2 text-gray-500">
                {car.license_plate}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <CarStatusBadge status={car.status} className="px-4 py-2 text-sm" />

              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </div>

          </div>
        </div>

        {car.is_away_from_home && (
          <div
            className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <div>
              <p className="font-medium">
                Away from home airport
              </p>

              <p className="mt-1 text-sm">
                This car is at {car.current_location.airport_code} but belongs
                at {car.home_location.airport_code}. Once it has been driven
                back, record it here.
              </p>

              {relocateError && (
                <p className="mt-2 text-sm text-red-700">{relocateError}</p>
              )}
            </div>

            <Button
              variant="secondary"
              onClick={handleReturnToHome}
              disabled={relocating}
            >
              {relocating
                ? "Saving..."
                : `Return to ${car.home_location.airport_code}`}
            </Button>
          </div>
        )}

        {/* Vehicle information */}
        <section className="rounded-xl bg-surface p-6 shadow-sm">

          <h2 className="text-xl font-semibold">
            Vehicle Information
          </h2>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">

            <div>
              <p className="text-sm text-gray-500">
                License Plate
              </p>

              <p className="mt-1 font-medium">
                {car.license_plate}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Year
              </p>

              <p className="mt-1 font-medium">
                {car.year}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Category
              </p>

              <p className="mt-1 font-medium">
                {car.category || "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Price / Day
              </p>

              <p className="mt-1 font-medium">
                {formatCurrency(car.price_per_day)}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Transmission
              </p>

              <p className="mt-1 font-medium">
                {car.transmission || "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Fuel
              </p>

              <p className="mt-1 font-medium">
                {car.fuel_type || "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Seats
              </p>

              <p className="mt-1 font-medium">
                {car.seats ?? "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Current Location
              </p>

              <p className="mt-1 font-medium">
                {car.current_location.airport_code}
              </p>

              <p className="text-sm text-gray-500">
                {car.current_location.name}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Home Airport
              </p>

              <p className="mt-1 font-medium">
                {car.home_location.airport_code}
              </p>

              <p className="text-sm text-gray-500">
                {car.home_location.name}
              </p>
            </div>

          </div>
        </section>

        {/* Vehicle condition */}
        <section className="mt-6 rounded-xl bg-surface p-6 shadow-sm">

          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              Vehicle Condition
            </h2>

            <Button variant="secondary" onClick={() => setEditingCondition(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">

            <div>
              <p className="text-sm text-gray-500">
                Mileage
              </p>

              <p className="mt-1 font-medium">
                {car.mileage != null ? `${car.mileage.toLocaleString()} km` : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Tire Condition
              </p>

              <p className="mt-1 font-medium">
                {car.tire_condition ? car.tire_condition.replace("_", " ") : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Last Oil Change
              </p>

              <p className="mt-1 font-medium">
                {car.last_oil_change_at ? formatDate(car.last_oil_change_at) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Last Inspection
              </p>

              <p className="mt-1 font-medium">
                {car.last_inspection_at ? formatDate(car.last_inspection_at) : "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Next Inspection Due
              </p>

              <p className="mt-1 font-medium">
                {car.next_inspection_due ? formatDate(car.next_inspection_due) : "—"}
                {inspectionStatus(car.next_inspection_due) === "overdue" && (
                  <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                    Overdue
                  </span>
                )}
                {inspectionStatus(car.next_inspection_due) === "soon" && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                    Due soon
                  </span>
                )}
              </p>
            </div>

          </div>
        </section>

        {/* Maintenance history */}
        <section className="mt-6 rounded-xl bg-surface p-6 shadow-sm">

          <div className="flex items-center justify-between">

            <div>
              <h2 className="text-xl font-semibold">
                Maintenance History
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Maintenance and cleaning tasks logged for this vehicle
              </p>
            </div>

            <Button variant="secondary" onClick={() => setLoggingTask(true)}>
              <Wrench className="h-4 w-4" />
              Log Task
            </Button>

          </div>

          {maintenanceTasks.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium text-gray-700">
                No maintenance history
              </p>

              <p className="mt-1 text-sm text-gray-500">
                Nothing has been logged for this vehicle yet.
              </p>
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
                        {task.notes || "No notes"}
                      </p>

                      <p className="mt-0.5 text-xs text-gray-500">
                        Out of service{" "}
                        {formatDateTime(task.starts_at ?? task.opened_at)}
                        {task.ends_at ? (
                          <> → {formatDateTime(task.ends_at)}</>
                        ) : (
                          <> until closed</>
                        )}
                        {task.completed_at && (
                          <> · Closed {formatDateTime(task.completed_at)}</>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-start sm:self-auto">
                    <span className="text-xs font-medium text-gray-500">
                      {task.status}
                    </span>

                    {task.status === "OPEN" && (
                      <>
                        <button
                          onClick={() => handleCompleteTask(task)}
                          className="rounded-lg border border-border-strong bg-white px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                        >
                          Mark Complete
                        </button>

                        <button
                          onClick={() => handleCancelTask(task.id)}
                          className="rounded-lg border border-border-strong bg-white px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Availability timeline */}
        <section className="mt-6 rounded-xl bg-surface p-6 shadow-sm">

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

            <div>
              <h2 className="text-xl font-semibold">
                Availability Schedule
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Next {timelineRange.label}
              </p>
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
                      ? "bg-white text-ink shadow-sm"
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
                />
                Reserved
              </div>

              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${getReservationStatusStyle("ACTIVE", "dot")}`}
                />
                Active
              </div>

              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${getReservationStatusStyle("COMPLETED", "dot")}`}
                />
                Completed
              </div>

              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-amber-400" />
                Out of service
              </div>

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
                              ? date.toLocaleDateString(undefined, {
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
                            {date.toLocaleDateString(
                              undefined,
                              {
                                weekday: "short",
                              }
                            )}
                          </p>

                          <p className="mt-1 font-medium">
                            {date.getDate()}
                          </p>

                          <p className="text-xs text-ink-muted">
                            {date.toLocaleDateString(
                              undefined,
                              {
                                month: "short",
                              }
                            )}
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
                        className="shrink-0 border-r border-gray-100"
                      />
                    )
                  )}

                </div>

                {/* Today marker */}
                <div
                  className="absolute bottom-0 top-0 border-l-2 border-dashed border-gray-900"
                  style={{
                    left: 0,
                  }}
                />

                {/* Reservations */}
                {visibleReservations.map(
                  (reservation, index) => {

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
                            index * 70 + 10,
                          height: 50,
                        }}
                        title={`${reservation.customer.first_name} ${reservation.customer.last_name} — ${formatDateTime(
                          reservation.pickup_at
                        )} → ${formatDateTime(
                          reservation.return_at
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
                              reservation.pickup_at
                            )}
                            {" → "}
                            {formatDate(
                              reservation.return_at
                            )}
                          </p>

                        </div>

                      </div>
                    );
                  }
                )}

                {/* Maintenance / cleaning windows */}
                {visibleTasks.map(({ task, start, end }, taskIndex) => {
                  const position = getTaskPosition(start, end);

                  return (
                    <div
                      key={task.id}
                      className="absolute flex items-center overflow-hidden rounded-lg border border-amber-300 bg-amber-100 px-3 text-amber-900 shadow-sm"
                      style={{
                        left: position.left,
                        width: position.width,
                        top: (visibleReservations.length + taskIndex) * 70 + 10,
                        height: 50,
                      }}
                      title={`${task.task_type} — ${formatDateTime(
                        start.toISOString()
                      )} → ${
                        task.ends_at
                          ? formatDateTime(end.toISOString())
                          : "until closed"
                      }${task.notes ? ` — ${task.notes}` : ""}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {task.task_type === "CLEANING" ? "Cleaning" : "Maintenance"}
                        </p>

                        <p className="truncate text-xs opacity-90">
                          {task.notes || "Out of service"}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Available indicator */}
                {timelineRowCount ===
                  0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-lg bg-gray-100 px-6 py-3 text-sm font-medium text-gray-700">
                      Vehicle available — no
                      reservations or maintenance in this period
                    </div>
                  </div>
                )}

              </div>

            </div>

          </div>

          <p className="mt-4 text-xs text-ink-muted">
            Scroll horizontally to view the full
            schedule.
          </p>

        </section>

        {/* Reservation details */}
        <section className="mt-6 rounded-xl bg-surface p-6 shadow-sm">

          <div className="flex items-center justify-between">

            <div>
              <h2 className="text-xl font-semibold">
                Reservations
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Detailed booking information
              </p>
            </div>

            <span className="text-sm text-gray-500">
              {reservations.length} booking
              {reservations.length !== 1
                ? "s"
                : ""}
            </span>

          </div>

          {reservations.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed p-8 text-center">

              <p className="font-medium text-gray-700">
                No reservations
              </p>

              <p className="mt-1 text-sm text-gray-500">
                This vehicle has no bookings.
              </p>

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
                    className="cursor-pointer rounded-lg border p-4 hover:bg-gray-50"
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

                        <p className="mt-1 text-sm text-gray-500">
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
                            reservation.pickup_at
                          )}
                          {" → "}
                          {formatDate(
                            reservation.return_at
                          )}
                        </p>

                        <p className="mt-1 text-sm text-gray-500">
                          {formatDateTime(
                            reservation.pickup_at
                          )}
                          {" → "}
                          {formatDateTime(
                            reservation.return_at
                          )}
                        </p>

                      </div>

                      <span
                        className={`self-start rounded-full px-3 py-1 text-xs font-medium md:self-auto ${getReservationClass(
                          reservation.status
                        )}`}
                      >
                        {reservation.status}
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