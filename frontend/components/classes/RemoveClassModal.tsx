"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { removeVehicleClass, type VehicleClass } from "@/lib/api";
import { classWords } from "@/lib/classDisplay";
import { t } from "@/lib/i18n";

/** Removing a class: where its cars go first. The class is then deleted, or only hidden when bookings were made for it. */
export function RemoveClassModal({
  row,
  classes,
  onClose,
  onRemoved,
}: {
  row: VehicleClass;
  classes: VehicleClass[];
  onClose: () => void;
  onRemoved: (outcome: "deleted" | "retired") => void;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const choices = classes.filter((item) => item.id !== row.id && !item.is_retired);

  async function confirm() {
    setBusy(true);
    setError("");

    try {
      onRemoved(await removeVehicleClass(row.id, target || null));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.classes.RemoveClassModal.failed"));
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.classes.RemoveClassModal.title", { name: classWords(row.name) })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("c.classes.RemoveClassModal.cancel")}
          </Button>
          <Button onClick={confirm} loading={busy}>
            {t("c.classes.RemoveClassModal.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-secondary">{t("c.classes.RemoveClassModal.explanation")}</p>

      {row.car_count > 0 && (
        <SelectField
          className="mt-4"
          label={t("c.classes.RemoveClassModal.moveCars", { count: row.car_count })}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">{t("c.classes.RemoveClassModal.noClass")}</option>
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {classWords(item.name)}
            </option>
          ))}
        </SelectField>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
