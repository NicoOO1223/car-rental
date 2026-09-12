"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";

import {
  cancelMaintenanceTask,
  completeMaintenanceTask,
  getCars,
  getMaintenanceTasks,
  type Car,
  type MaintenanceTask,
} from "@/lib/api";
import { CarStatusBadge } from "@/components/ui/Badge";
import { Skeleton, SkeletonRows, SkeletonStatTiles } from "@/components/ui/Skeleton";
import { NewTaskModal } from "@/components/maintenance/NewTaskModal";

export default function MaintenancePage() {
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [cars, setCars] = useState<Car[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [showNewTask, setShowNewTask] = useState(false);

  // Reusable reload, for the Refresh button and post-action refetches —
  // kept separate from the mount/filter-change effect below so an effect
  // body never directly triggers this outer setState-calling function.
  async function loadTasks(showRefreshing = false) {
    if (showRefreshing) {
      setRefreshing(true);
    }

    setError("");

    try {
      const data = await getMaintenanceTasks(
        statusFilter === "ALL" ? undefined : { status: statusFilter },
      );
      setTasks(data);
    } catch {
      setError("Failed to load maintenance tasks.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    async function fetchTasks() {
      setError("");

      try {
        const data = await getMaintenanceTasks(
          statusFilter === "ALL" ? undefined : { status: statusFilter },
        );
        setTasks(data);
      } catch {
        setError("Failed to load maintenance tasks.");
      } finally {
        setLoading(false);
      }
    }

    fetchTasks();
  }, [statusFilter]);

  useEffect(() => {
    getCars()
      .then(setCars)
      .catch(() => {});
  }, []);

  function formatDateTime(date: string) {
    return new Date(date).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const statistics = useMemo(() => {
    const openMaintenance = tasks.filter(
      (task) => task.status === "OPEN" && task.task_type === "MAINTENANCE",
    ).length;
    const openCleaning = tasks.filter(
      (task) => task.status === "OPEN" && task.task_type === "CLEANING",
    ).length;

    return { openMaintenance, openCleaning };
  }, [tasks]);

  async function handleComplete(taskId: string) {
    await completeMaintenanceTask(taskId);
    loadTasks(true);
  }

  async function handleCancel(taskId: string) {
    await cancelMaintenanceTask(taskId);
    loadTasks(true);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-6xl">
          <Skeleton className="mb-8 h-9 w-64" />
          <SkeletonStatTiles count={2} className="mb-6 grid gap-4 sm:grid-cols-2" />
          <SkeletonRows count={4} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Maintenance</h1>

            <p className="mt-2 text-gray-600">
              Fleet-wide maintenance and cleaning tasks — a car with an
              open task is automatically excluded from new bookings.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => loadTasks(true)}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </button>

            <button
              onClick={() => setShowNewTask(true)}
              disabled={cars.length === 0}
              className="flex items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              New Task
            </button>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Open maintenance</p>
            <p className="mt-2 text-3xl font-bold">{statistics.openMaintenance}</p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Open cleaning</p>
            <p className="mt-2 text-3xl font-bold">{statistics.openCleaning}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Status
          </label>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 outline-none focus:border-black sm:w-64"
          >
            <option value="OPEN">Open</option>
            <option value="DONE">Done</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="ALL">All</option>
          </select>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {/* Results list */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          {/* Mobile: card list */}
          <div className="divide-y lg:hidden">
            {tasks.map((task) => (
              <div key={task.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {task.car.make} {task.car.model}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {task.car.license_plate}
                    </p>
                  </div>
                  <CarStatusBadge status={task.task_type} className="shrink-0" />
                </div>

                <p className="mt-2 text-sm text-gray-700">
                  {task.notes || "No notes"}
                </p>

                <p className="mt-1 text-xs text-gray-500">
                  Opened {formatDateTime(task.opened_at)}
                  {task.completed_at && (
                    <> · Closed {formatDateTime(task.completed_at)}</>
                  )}
                </p>

                {task.status === "OPEN" && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => handleComplete(task.id)}
                      className="flex-1 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-gray-50"
                    >
                      Mark Complete
                    </button>
                    <button
                      onClick={() => handleCancel(task.id)}
                      className="flex-1 rounded-lg border px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-sm font-semibold">Vehicle</th>
                  <th className="px-6 py-4 text-sm font-semibold">Type</th>
                  <th className="px-6 py-4 text-sm font-semibold">Notes</th>
                  <th className="px-6 py-4 text-sm font-semibold">Opened</th>
                  <th className="px-6 py-4 text-sm font-semibold">Status</th>
                  <th className="px-6 py-4 text-sm font-semibold" />
                </tr>
              </thead>

              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="border-b last:border-b-0">
                    <td className="px-6 py-5">
                      <div className="font-medium">
                        {task.car.make} {task.car.model}
                      </div>
                      <div className="mt-1 text-sm text-gray-500">
                        {task.car.license_plate}
                      </div>
                    </td>

                    <td className="px-6 py-5">
                      <CarStatusBadge status={task.task_type} />
                    </td>

                    <td className="px-6 py-5 text-sm text-gray-700">
                      {task.notes || "—"}
                    </td>

                    <td className="px-6 py-5 text-sm text-gray-500">
                      {formatDateTime(task.opened_at)}
                      {task.completed_at && (
                        <div>Closed {formatDateTime(task.completed_at)}</div>
                      )}
                    </td>

                    <td className="px-6 py-5 text-sm font-medium text-gray-500">
                      {task.status}
                    </td>

                    <td className="px-6 py-5 text-right">
                      {task.status === "OPEN" && (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleComplete(task.id)}
                            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
                          >
                            Mark Complete
                          </button>
                          <button
                            onClick={() => handleCancel(task.id)}
                            className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {tasks.length === 0 && !error && (
          <div className="mt-6 rounded-xl bg-white p-10 text-center shadow-sm">
            <p className="font-medium text-gray-700">No tasks found</p>
            <p className="mt-1 text-sm text-gray-500">
              Nothing matches this filter right now.
            </p>
          </div>
        )}

      </div>

      {showNewTask && (
        <NewTaskModal
          cars={cars}
          onClose={() => setShowNewTask(false)}
          onCreated={() => loadTasks(true)}
        />
      )}
    </main>
  );
}
