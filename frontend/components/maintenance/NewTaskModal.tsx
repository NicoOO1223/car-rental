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
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!carId) {
      setError("Select a vehicle.");
      return;
    }

    if (taskType === "MAINTENANCE" && !category) {
      setError("Select a maintenance category.");
      return;
    }

    if (!startsAt || !endsAt) {
      setError("Select when the vehicle is out of service.");
      return;
    }

    // datetime-local values are local time; the API wants an instant.
    const start = new Date(startsAt);
    const end = new Date(endsAt);

    if (end <= start) {
      setError("The end must be after the start.");
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
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
      });

      onCreated(task);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="Log a task"
      description="The vehicle is unavailable for new bookings during this period and shows on its calendar."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-task-form" loading={saving}>
            {saving ? "Saving" : "Log task"}
          </Button>
        </>
      }
    >
      <form id="new-task-form" onSubmit={handleSubmit} className="space-y-4">
        {car ? (
          <Field label="Vehicle">
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
            label="Vehicle"
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
          label="Task type"
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
            label="Category"
            required
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Select a category...</option>
            {MAINTENANCE_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Out of service from"
            type="datetime-local"
            required
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />

          <TextField
            label="Back in service at"
            type="datetime-local"
            required
            min={startsAt || undefined}
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </div>

        <Field label="Notes">
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Reason for this task..."
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
