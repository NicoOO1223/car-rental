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
import { CompleteTaskModal } from "@/components/maintenance/CompleteTaskModal";
import { NewTaskModal } from "@/components/maintenance/NewTaskModal";
import { maintenanceCategoryLabel } from "@/lib/maintenance";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useUrlFilters } from "@/lib/useUrlFilters";
import { t } from "@/lib/i18n";

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
  const [completingTask, setCompletingTask] = useState<MaintenanceTask | null>(
    null,
  );

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
        if (!cancelled) setError(t("s.maintenance.failedLoadMaintenanceTasks"));
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
      setError(t("s.maintenance.failedLoadMaintenanceTasks"));
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
      header: t("s.maintenance.vehicle"),
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
      header: t("s.maintenance.plate"),
      mobile: "secondary",
      mobileOnly: true,
      cell: (task) => task.car.license_plate,
    },
    {
      id: "type",
      header: t("s.maintenance.type"),
      mobile: "trailing",
      cell: (task) => (
        <div className="flex flex-col items-start gap-1">
          <TaskTypeBadge taskType={task.task_type} />
          {task.category && (
            <span className="text-xs text-ink-muted">
              {maintenanceCategoryLabel(task.category)}
            </span>
          )}
        </div>
      ),
      sortable: true,
      sortAccessor: (task) => task.task_type,
    },
    {
      id: "notes",
      header: t("s.maintenance.notes"),
      mobile: "hidden",
      cell: (task) => (
        <span className="text-sm text-ink-secondary">{task.notes || "—"}</span>
      ),
    },
    {
      id: "window",
      header: t("s.maintenance.outService"),
      mobileLabel: t("s.maintenance.outService"),
      cell: (task) => (
        <div className="text-sm text-ink-muted">
          <div>{formatDateTime(task.starts_at ?? task.opened_at)}</div>
          <div className="mt-0.5">
            {task.ends_at ? t("s.maintenance.untilDate", { date: formatDateTime(task.ends_at) }) : t("s.maintenance.untilClosed")}
          </div>
        </div>
      ),
      mobileCell: (task) =>
        `${formatDateTime(task.starts_at ?? task.opened_at)} – ${
          task.ends_at ? formatDateTime(task.ends_at) : t("s.maintenance.untilClosed")
        }`,
      sortable: true,
      sortAccessor: (task) => new Date(task.starts_at ?? task.opened_at),
    },
    {
      id: "cost",
      header: t("s.maintenance.cost"),
      mobileLabel: t("s.maintenance.cost"),
      cell: (task) => (
        <span className="text-sm text-ink-muted">
          {task.cost != null ? formatCurrency(task.cost) : "—"}
        </span>
      ),
      sortable: true,
      sortAccessor: (task) => (task.cost != null ? Number(task.cost) : -1),
    },
    {
      id: "opened",
      header: t("s.maintenance.opened"),
      mobileLabel: t("s.maintenance.opened"),
      cell: (task) => (
        <div className="text-sm text-ink-muted">
          <div>{formatDateTime(task.opened_at)}</div>
          {task.completed_at && (
            <div className="mt-0.5">{t("s.maintenance.closed", { v1: formatDateTime(task.completed_at) })}</div>
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
      header: t("s.maintenance.status"),
      mobileLabel: t("s.maintenance.status"),
      cell: (task) => <TaskStatusBadge status={task.status} />,
      sortable: true,
      sortAccessor: (task) => task.status,
    },
  ];

  return (
    <PageShell width="medium">
      <PageHeader
        title={t("s.maintenance.maintenance")}
        description={t("s.maintenance.fleetWideMaintenanceCleaning")}
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
              />{t("s.maintenance.refresh")}</Button>

            <Button
              onClick={() => setShowNewTask(true)}
              disabled={cars.length === 0}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />{t("s.maintenance.newTask")}</Button>
          </>
        }
      />

      <StatTileGrid columns={2} className="mb-6">
        <StatTile
          label={t("s.maintenance.openMaintenance")}
          value={statistics.openMaintenance}
          icon={Wrench}
        />
        <StatTile label={t("s.maintenance.openCleaning")} value={statistics.openCleaning} />
      </StatTileGrid>

      <Toolbar>
        <Field label={t("s.maintenance.status")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={statusFilter}
              onChange={(event) => setFilters({ status: event.target.value })}
            >
              <option value="OPEN">{t("s.maintenance.open")}</option>
              <option value="DONE">{t("s.maintenance.done")}</option>
              <option value="CANCELLED">{t("s.maintenance.cancelled")}</option>
              <option value="ALL">{t("s.maintenance.all")}</option>
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
            label: t("s.maintenance.markComplete"),
            onClick: async (task) => {
              // An inspection records itself on the car and needs its
              // next due date, so it goes through a form first.
              if (task.category === "TECHNICAL_INSPECTION") {
                setCompletingTask(task);
                return;
              }

              await completeMaintenanceTask(task.id);
              refreshTasks();
            },
            hidden: (task) => task.status !== "OPEN",
          },
          {
            label: t("s.maintenance.cancel"),
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
          title: t("s.maintenance.noTasksFound"),
          description: t("s.maintenance.nothingMatchesFilterRight"),
        }}
      />

      {completingTask && (
        <CompleteTaskModal
          task={completingTask}
          onClose={() => setCompletingTask(null)}
          onCompleted={refreshTasks}
        />
      )}

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
