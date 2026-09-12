"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createMaintenanceTask, type Car, type MaintenanceTask } from "@/lib/api";

const TASK_TYPE_OPTIONS = ["MAINTENANCE", "CLEANING"];

const inputClass = "mt-2 w-full rounded-lg border p-3";
const labelClass = "block text-sm font-medium";

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
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!carId) {
      setError("Select a vehicle.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const task = await createMaintenanceTask({
        car_id: carId,
        task_type: taskType,
        notes: notes || null,
      });

      onCreated(task);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to log task.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="Log Maintenance / Cleaning Task"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-task-form" disabled={saving}>
            {saving ? "Saving..." : "Log Task"}
          </Button>
        </>
      }
    >
      <form id="new-task-form" onSubmit={handleSubmit} className="space-y-4">
        {car ? (
          <div>
            <label className={labelClass}>Vehicle</label>
            <p className="mt-2 rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
              {car.make} {car.model} · {car.license_plate}
            </p>
          </div>
        ) : (
          <div>
            <label className={labelClass}>Vehicle</label>
            <select
              value={carId}
              onChange={(e) => setCarId(e.target.value)}
              className={inputClass}
              required
            >
              {cars?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.make} {option.model} · {option.license_plate}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className={labelClass}>Task Type</label>
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value)}
            className={inputClass}
          >
            {TASK_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
            rows={3}
            placeholder="Reason for this task..."
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
