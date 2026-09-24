"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { updateCar, type Car } from "@/lib/api";

const TIRE_CONDITION_OPTIONS = ["GOOD", "FAIR", "WORN", "NEEDS_REPLACEMENT"];

type Props = {
  car: Car;
  onClose: () => void;
  onSaved: (updated: Car) => void;
};

export function VehicleConditionModal({ car, onClose, onSaved }: Props) {
  const [mileage, setMileage] = useState(
    car.mileage != null ? String(car.mileage) : "",
  );
  const [tireCondition, setTireCondition] = useState(car.tire_condition ?? "");
  const [lastOilChangeAt, setLastOilChangeAt] = useState(
    car.last_oil_change_at ?? "",
  );
  const [lastInspectionAt, setLastInspectionAt] = useState(
    car.last_inspection_at ?? "",
  );
  const [nextInspectionDue, setNextInspectionDue] = useState(
    car.next_inspection_due ?? "",
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const updated = await updateCar(car.id, {
        mileage: mileage === "" ? null : Number(mileage),
        tire_condition: tireCondition || null,
        last_oil_change_at: lastOilChangeAt || null,
        last_inspection_at: lastInspectionAt || null,
        next_inspection_due: nextInspectionDue || null,
      });

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update vehicle condition.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="Edit vehicle condition"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="vehicle-condition-form" loading={saving}>
            {saving ? "Saving" : "Save changes"}
          </Button>
        </>
      }
    >
      <form
        id="vehicle-condition-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Mileage (km)"
            type="number"
            min="0"
            value={mileage}
            onChange={(event) => setMileage(event.target.value)}
          />

          <SelectField
            label="Tire condition"
            value={tireCondition}
            onChange={(event) => setTireCondition(event.target.value)}
          >
            <option value="">Unknown</option>
            {TIRE_CONDITION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.replace("_", " ")}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Last oil change"
            type="date"
            className="sm:col-span-2"
            value={lastOilChangeAt}
            onChange={(event) => setLastOilChangeAt(event.target.value)}
          />

          <TextField
            label="Last inspection"
            type="date"
            value={lastInspectionAt}
            onChange={(event) => setLastInspectionAt(event.target.value)}
          />

          <TextField
            label="Next inspection due"
            type="date"
            value={nextInspectionDue}
            onChange={(event) => setNextInspectionDue(event.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
