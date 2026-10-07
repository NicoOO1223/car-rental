"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { completeMaintenanceTask, type MaintenanceTask } from "@/lib/api";
import { t } from "@/lib/i18n";

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
  const [cost, setCost] = useState(task.cost ?? "");

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
      setError(t("c.maintenance.CompleteTaskModal.enterWhenNextInspection"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const updated = await completeMaintenanceTask(task.id, nextDue, cost || null);

      onCompleted(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.maintenance.CompleteTaskModal.failedCompleteTask"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.maintenance.CompleteTaskModal.completeTechnicalInspection")}
      description={t("c.maintenance.CompleteTaskModal.todayWillBeRecorded", { make: task.car.make, model: task.car.model, license_plate: task.car.license_plate })}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.maintenance.CompleteTaskModal.cancel")}</Button>
          <Button type="submit" form="complete-task-form" loading={saving}>
            {saving ? t("c.maintenance.CompleteTaskModal.saving") : t("c.maintenance.CompleteTaskModal.markComplete")}
          </Button>
        </>
      }
    >
      <form id="complete-task-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label={t("c.maintenance.CompleteTaskModal.nextInspectionDue")}
          type="date"
          required
          min={minDate}
          value={nextDue}
          onChange={(event) => setNextDue(event.target.value)}
        />

        <TextField
          label={t("c.maintenance.CompleteTaskModal.finalCost")}
          type="number"
          min={0}
          step="0.01"
          hint={t("c.maintenance.CompleteTaskModal.finalCostHint")}
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
