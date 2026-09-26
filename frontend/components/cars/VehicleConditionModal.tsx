"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { updateCar, type Car } from "@/lib/api";
import { t, enumLabel } from "@/lib/i18n";

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
  const [insuredFrom, setInsuredFrom] = useState(car.insured_from ?? "");
  const [insuredUntil, setInsuredUntil] = useState(car.insured_until ?? "");
  const [insuranceCost, setInsuranceCost] = useState(car.insurance_cost ?? "");

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
        insured_from: insuredFrom || null,
        insured_until: insuredUntil || null,
        insurance_cost: insuranceCost || null,
      });

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("c.cars.VehicleConditionModal.failedUpdateVehicleCondition"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.cars.VehicleConditionModal.editVehicleCondition")}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.cars.VehicleConditionModal.cancel")}</Button>
          <Button type="submit" form="vehicle-condition-form" loading={saving}>
            {saving ? t("c.cars.VehicleConditionModal.saving") : t("c.cars.VehicleConditionModal.saveChanges")}
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
            label={t("c.cars.VehicleConditionModal.mileageKm")}
            type="number"
            min="0"
            value={mileage}
            onChange={(event) => setMileage(event.target.value)}
          />

          <SelectField
            label={t("c.cars.VehicleConditionModal.tireCondition")}
            value={tireCondition}
            onChange={(event) => setTireCondition(event.target.value)}
          >
            <option value="">{t("c.cars.VehicleConditionModal.unknown")}</option>
            {TIRE_CONDITION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {enumLabel("tireCondition", option)}
              </option>
            ))}
          </SelectField>

          <TextField
            label={t("c.cars.VehicleConditionModal.lastOilChange")}
            type="date"
            className="sm:col-span-2"
            value={lastOilChangeAt}
            onChange={(event) => setLastOilChangeAt(event.target.value)}
          />

          <TextField
            label={t("c.cars.VehicleConditionModal.lastInspection")}
            type="date"
            value={lastInspectionAt}
            onChange={(event) => setLastInspectionAt(event.target.value)}
          />

          <TextField
            label={t("c.cars.VehicleConditionModal.nextInspectionDue")}
            type="date"
            value={nextInspectionDue}
            onChange={(event) => setNextInspectionDue(event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label={t("c.cars.VehicleConditionModal.insuredSince")}
            type="date"
            value={insuredFrom}
            onChange={(event) => setInsuredFrom(event.target.value)}
          />

          <TextField
            label={t("c.cars.VehicleConditionModal.insuredUntil")}
            type="date"
            min={insuredFrom || undefined}
            value={insuredUntil}
            onChange={(event) => setInsuredUntil(event.target.value)}
          />

          <TextField
            label={t("c.cars.VehicleConditionModal.insuranceCost")}
            type="number"
            min={0}
            step="0.01"
            hint={t("c.cars.VehicleConditionModal.insuranceCostHint")}
            value={insuranceCost}
            onChange={(event) => setInsuranceCost(event.target.value)}
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
