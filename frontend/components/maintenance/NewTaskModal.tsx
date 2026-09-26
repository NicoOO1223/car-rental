"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, SelectField, Textarea, TextField } from "@/components/ui/Field";
import { MAINTENANCE_CATEGORIES } from "@/lib/maintenance";
import {
  createMaintenanceTask,
  type Car,
  type MaintenanceTask,
} from "@/lib/api";
import { t } from "@/lib/i18n";

const TASK_TYPE_OPTIONS = ["MAINTENANCE", "CLEANING"];

type Props = {
  // Car detail page usage: car is fixed, no picker shown.
  car?: Car;
  // Queue page usage: pick from the full fleet.
  cars?: Car[];
  onClose: () => void;
  onCreated: (task: MaintenanceTask) => void;
};

export function NewTaskModal({ car, cars, onClose, onCreated }: Props) {
  const [carId, setCarId] = useState(car?.id ?? cars?.[0]?.id ?? "");
  const [taskType, setTaskType] = useState("MAINTENANCE");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!carId) {
      setError(t("c.maintenance.NewTaskModal.selectVehicle"));
      return;
    }

    if (taskType === "MAINTENANCE" && !category) {
      setError(t("c.maintenance.NewTaskModal.selectMaintenanceCategory"));
      return;
    }

    if (!startsAt || !endsAt) {
      setError(t("c.maintenance.NewTaskModal.selectWhenVehicleOut"));
      return;
    }

    // datetime-local values are local time; the API wants an instant.
    const start = new Date(startsAt);
    const end = new Date(endsAt);

    if (end <= start) {
      setError(t("c.maintenance.NewTaskModal.endMustBeAfter"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const task = await createMaintenanceTask({
        car_id: carId,
        task_type: taskType,
        category: taskType === "MAINTENANCE" ? category : null,
        notes: notes || null,
        cost: cost || null,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
      });

      onCreated(task);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.maintenance.NewTaskModal.failedLogTask"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.maintenance.NewTaskModal.logTask")}
      description={t("c.maintenance.NewTaskModal.vehicleUnavailableNewBookings")}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.maintenance.NewTaskModal.cancel")}</Button>
          <Button type="submit" form="new-task-form" loading={saving}>
            {saving ? t("c.maintenance.NewTaskModal.saving") : t("c.maintenance.NewTaskModal.logTask2")}
          </Button>
        </>
      }
    >
      <form id="new-task-form" onSubmit={handleSubmit} className="space-y-4">
        {car ? (
          <Field label={t("c.maintenance.NewTaskModal.vehicle")}>
            {(fieldProps) => (
              <p
                id={fieldProps.id}
                className="rounded-lg border border-border-strong bg-surface-sunken px-3.5 py-2.5 text-sm text-ink-secondary"
              >
                {car.make} {car.model} · {car.license_plate}
              </p>
            )}
          </Field>
        ) : (
          <SelectField
            label={t("c.maintenance.NewTaskModal.vehicle")}
            required
            value={carId}
            onChange={(event) => setCarId(event.target.value)}
          >
            {cars?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.make} {option.model} · {option.license_plate}
              </option>
            ))}
          </SelectField>
        )}

        <SelectField
          label={t("c.maintenance.NewTaskModal.taskType")}
          value={taskType}
          onChange={(event) => setTaskType(event.target.value)}
        >
          {TASK_TYPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectField>

        {taskType === "MAINTENANCE" && (
          <SelectField
            label={t("c.maintenance.NewTaskModal.category")}
            required
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{t("c.maintenance.NewTaskModal.selectCategory")}</option>
            {MAINTENANCE_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("c.maintenance.NewTaskModal.outServiceFrom")}
            type="datetime-local"
            required
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />

          <TextField
            label={t("c.maintenance.NewTaskModal.backServiceAt")}
            type="datetime-local"
            required
            min={startsAt || undefined}
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </div>

        <TextField
          label={t("c.maintenance.NewTaskModal.cost")}
          type="number"
          min={0}
          step="0.01"
          hint={t("c.maintenance.NewTaskModal.costHint")}
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />

        <Field label={t("c.maintenance.NewTaskModal.notes")}>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t("c.maintenance.NewTaskModal.reasonTask")}
            />
          )}
        </Field>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
