"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Wrench } from "lucide-react";

import {
  cancelMaintenanceTask,
  completeMaintenanceTask,
  getCars,
  getMaintenanceTasks,
  type Car,
  type MaintenanceTask,
} from "@/lib/api";
import { TaskStatusBadge, TaskTypeBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { Field, Select } from "@/components/ui/Field";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { Toolbar } from "@/components/ui/Toolbar";
import { NewTaskModal } from "@/components/maintenance/NewTaskModal";
import { formatDateTime } from "@/lib/format";
import { useUrlFilters } from "@/lib/useUrlFilters";

const FILTER_DEFAULTS = {
  status: "OPEN",
};

export default function MaintenancePage() {
  const { filters, setFilters } = useUrlFilters(FILTER_DEFAULTS);
  const statusFilter = filters.status;

  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [cars, setCars] = useState<Car[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showNewTask, setShowNewTask] = useState(false);

  // This filter is genuinely server-side, unlike every other list page.
  //
  // The mount/filter-change effect defines its own loader inline rather
  // than calling the shared one below. Calling an outer setState-ing
  // function straight from an effect body trips react-hooks/set-state-in-
  // effect; this is the pattern the rest of the app already uses.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError("");

      try {
        const data = await getMaintenanceTasks(
          statusFilter === "ALL" ? undefined : { status: statusFilter },
        );

        if (!cancelled) setTasks(data);
      } catch {
        if (!cancelled) setError("Failed to load maintenance tasks.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  // Used by the Refresh button and by post-action refetches only.
  const refreshTasks = useCallback(async () => {
    setRefreshing(true);
    setError("");

    try {
      setTasks(
        await getMaintenanceTasks(
          statusFilter === "ALL" ? undefined : { status: statusFilter },
        ),
      );
    } catch {
      setError("Failed to load maintenance tasks.");
    } finally {
      setRefreshing(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    getCars()
      .then(setCars)
      .catch(() => {
        // Only disables the New Task button; not worth an error banner.
      });
  }, []);

  const statistics = useMemo(
    () => ({
      openMaintenance: tasks.filter(
        (task) => task.status === "OPEN" && task.task_type === "MAINTENANCE",
      ).length,
      openCleaning: tasks.filter(
        (task) => task.status === "OPEN" && task.task_type === "CLEANING",
      ).length,
    }),
    [tasks],
  );

  const columns: Column<MaintenanceTask>[] = [
    {
      id: "vehicle",
      header: "Vehicle",
      mobile: "primary",
      cell: (task) => (
        <TwoLine
          primary={`${task.car.make} ${task.car.model}`}
          secondary={task.car.license_plate}
        />
      ),
      mobileCell: (task) => `${task.car.make} ${task.car.model}`,
      sortable: true,
      sortAccessor: (task) => `${task.car.make} ${task.car.model}`,
    },
    {
      // The table folds the plate into the vehicle cell above; the card
      // needs it as its own line.
      id: "plate",
      header: "Plate",
      mobile: "secondary",
      mobileOnly: true,
      cell: (task) => task.car.license_plate,
    },
    {
      id: "type",
      header: "Type",
      mobile: "trailing",
      cell: (task) => <TaskTypeBadge taskType={task.task_type} />,
      sortable: true,
      sortAccessor: (task) => task.task_type,
    },
    {
      id: "notes",
      header: "Notes",
      mobile: "hidden",
      cell: (task) => (
        <span className="text-sm text-ink-secondary">{task.notes || "—"}</span>
      ),
    },
    {
      id: "opened",
      header: "Opened",
      mobileLabel: "Opened",
      cell: (task) => (
        <div className="text-sm text-ink-muted">
          <div>{formatDateTime(task.opened_at)}</div>
          {task.completed_at && (
            <div className="mt-0.5">
              Closed {formatDateTime(task.completed_at)}
            </div>
          )}
        </div>
      ),
      mobileCell: (task) => formatDateTime(task.opened_at),
      sortable: true,
      sortAccessor: (task) => new Date(task.opened_at),
      defaultSortDirection: "desc",
    },
    {
      id: "status",
      header: "Status",
      mobileLabel: "Status",
      cell: (task) => <TaskStatusBadge status={task.status} />,
      sortable: true,
      sortAccessor: (task) => task.status,
    },
  ];

  return (
    <PageShell width="medium">
      <PageHeader
        title="Maintenance"
        description="Fleet-wide maintenance and cleaning. A car with an open task is automatically excluded from new bookings."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={refreshTasks}
              disabled={refreshing}
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Refresh
            </Button>

            <Button
              onClick={() => setShowNewTask(true)}
              disabled={cars.length === 0}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New task
            </Button>
          </>
        }
      />

      <StatTileGrid columns={2} className="mb-6">
        <StatTile
          label="Open maintenance"
          value={statistics.openMaintenance}
          icon={Wrench}
        />
        <StatTile label="Open cleaning" value={statistics.openCleaning} />
      </StatTileGrid>

      <Toolbar>
        <Field label="Status">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={statusFilter}
              onChange={(event) => setFilters({ status: event.target.value })}
            >
              <option value="OPEN">Open</option>
              <option value="DONE">Done</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="ALL">All</option>
            </Select>
          )}
        </Field>
      </Toolbar>

      {error && (
        <div className="mb-6 rounded-xl bg-surface p-6 shadow-sm">
          <p className="text-red-600" role="alert">
            {error}
          </p>
        </div>
      )}

      <DataTable
        rows={tasks}
        columns={columns}
        rowKey={(task) => task.id}
        loading={loading}
        rowActions={[
          {
            label: "Mark complete",
            onClick: async (task) => {
              await completeMaintenanceTask(task.id);
              refreshTasks();
            },
            hidden: (task) => task.status !== "OPEN",
          },
          {
            label: "Cancel",
            variant: "ghost",
            onClick: async (task) => {
              await cancelMaintenanceTask(task.id);
              refreshTasks();
            },
            hidden: (task) => task.status !== "OPEN",
          },
        ]}
        empty={{
          icon: Wrench,
          title: "No tasks found",
          description: "Nothing matches this filter right now.",
        }}
      />

      {showNewTask && (
        <NewTaskModal
          cars={cars}
          onClose={() => setShowNewTask(false)}
          onCreated={refreshTasks}
        />
      )}
    </PageShell>
  );
}
