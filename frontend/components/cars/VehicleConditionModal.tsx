"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { updateCar, type Car } from "@/lib/api";

const TIRE_CONDITION_OPTIONS = ["GOOD", "FAIR", "WORN", "NEEDS_REPLACEMENT"];

type Props = {
  car: Car;
  onClose: () => void;
  onSaved: (updated: Car) => void;
};

const inputClass = "mt-2 w-full rounded-lg border p-3";
const labelClass = "block text-sm font-medium";

export function VehicleConditionModal({ car, onClose, onSaved }: Props) {
  const [mileage, setMileage] = useState(
    car.mileage != null ? String(car.mileage) : "",
  );
  const [tireCondition, setTireCondition] = useState(car.tire_condition ?? "");
  const [lastOilChangeAt, setLastOilChangeAt] = useState(
    car.last_oil_change_at ?? "",
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
      title="Edit Vehicle Condition"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="vehicle-condition-form" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
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
          <div>
            <label className={labelClass}>Mileage (km)</label>
            <input
              type="number"
              min="0"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Tire Condition</label>
            <select
              value={tireCondition}
              onChange={(e) => setTireCondition(e.target.value)}
              className={inputClass}
            >
              <option value="">Unknown</option>
              {TIRE_CONDITION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Last Oil Change</label>
            <input
              type="date"
              value={lastOilChangeAt}
              onChange={(e) => setLastOilChangeAt(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
