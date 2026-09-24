"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { completeMaintenanceTask, type MaintenanceTask } from "@/lib/api";

type Props = {
  task: MaintenanceTask;
  onClose: () => void;
  onCompleted: (task: MaintenanceTask) => void;
};

/**
 * Closing a technical-inspection task records the inspection on the car,
 * so it asks for the next due date right away.
 */
export function CompleteTaskModal({ task, onClose, onCompleted }: Props) {
  const [nextDue, setNextDue] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = `${tomorrow.getFullYear()}-${String(
    tomorrow.getMonth() + 1,
  ).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!nextDue) {
      setError("Enter when the next inspection is due.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const updated = await completeMaintenanceTask(task.id, nextDue);

      onCompleted(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="Complete technical inspection"
      description={`Today will be recorded as the last inspection of ${task.car.make} ${task.car.model} (${task.car.license_plate}).`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="complete-task-form" loading={saving}>
            {saving ? "Saving" : "Mark complete"}
          </Button>
        </>
      }
    >
      <form id="complete-task-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Next inspection due"
          type="date"
          required
          min={minDate}
          value={nextDue}
          onChange={(event) => setNextDue(event.target.value)}
        />

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
