"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { createCar, type Car, type Location } from "@/lib/api";
import { CATEGORY_OPTIONS, FUEL_OPTIONS, TRANSMISSION_OPTIONS } from "@/lib/carDisplay";
import { getDefaultCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";

type Props = {
  locations: Location[];
  onClose: () => void;
  onCreated: (car: Car) => void;
};

/**
 * A vehicle joining the fleet. Only what is needed to rent it out is asked for;
 * the photo, insurance and inspection dates are added afterwards from the
 * vehicle's own page, like for any other car.
 */
export function AddVehicleModal({ locations, onClose, onCreated }: Props) {
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [licensePlate, setLicensePlate] = useState("");
  const [category, setCategory] = useState("");
  const [transmission, setTransmission] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [seats, setSeats] = useState("");
  const [pricePerDay, setPricePerDay] = useState("");
  const [mileage, setMileage] = useState("");
  const [homeLocationId, setHomeLocationId] = useState(locations[0]?.id ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const car = await createCar({
        make: make.trim(),
        model: model.trim(),
        year: Number(year),
        license_plate: licensePlate,
        category: category || null,
        transmission: transmission || null,
        fuel_type: fuelType || null,
        seats: seats === "" ? null : Number(seats),
        price_per_day: pricePerDay,
        home_location_id: homeLocationId,
        mileage: mileage === "" ? null : Number(mileage),
        // Offered online once it has a photo; that is a decision for the vehicle's page.
        offered_online: false,
      });

      onCreated(car);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.cars.AddVehicleModal.failedAdd"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.cars.AddVehicleModal.title")}
      description={t("c.cars.AddVehicleModal.description")}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("c.cars.AddVehicleModal.cancel")}
          </Button>
          <Button type="submit" form="add-vehicle-form" loading={saving}>
            {saving ? t("c.cars.AddVehicleModal.adding") : t("c.cars.AddVehicleModal.add")}
          </Button>
        </>
      }
    >
      <form id="add-vehicle-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t("c.cars.AddVehicleModal.make")} required maxLength={50} value={make} onChange={(event) => setMake(event.target.value)} />

          <TextField label={t("c.cars.AddVehicleModal.model")} required maxLength={50} value={model} onChange={(event) => setModel(event.target.value)} />

          <TextField
            label={t("c.cars.AddVehicleModal.licensePlate")}
            required
            maxLength={20}
            value={licensePlate}
            onChange={(event) => setLicensePlate(event.target.value)}
          />

          <TextField
            label={t("c.cars.AddVehicleModal.year")}
            type="number"
            required
            min={1980}
            max={2100}
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />

          <SelectField label={t("c.cars.AddVehicleModal.category")} value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{t("c.cars.AddVehicleModal.notSet")}</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <TextField
            label={t("c.cars.AddVehicleModal.pricePerDay", { currency: getDefaultCurrency() })}
            type="number"
            required
            min={0}
            step="0.01"
            value={pricePerDay}
            onChange={(event) => setPricePerDay(event.target.value)}
          />

          <SelectField label={t("c.cars.AddVehicleModal.transmission")} value={transmission} onChange={(event) => setTransmission(event.target.value)}>
            <option value="">{t("c.cars.AddVehicleModal.notSet")}</option>
            {TRANSMISSION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <SelectField label={t("c.cars.AddVehicleModal.fuelType")} value={fuelType} onChange={(event) => setFuelType(event.target.value)}>
            <option value="">{t("c.cars.AddVehicleModal.notSet")}</option>
            {FUEL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <TextField label={t("c.cars.AddVehicleModal.seats")} type="number" min={1} max={20} value={seats} onChange={(event) => setSeats(event.target.value)} />

          <TextField
            label={t("c.cars.AddVehicleModal.mileage")}
            type="number"
            min={0}
            value={mileage}
            onChange={(event) => setMileage(event.target.value)}
          />

          <SelectField
            label={t("c.cars.AddVehicleModal.homeAirport")}
            className="sm:col-span-2"
            hint={t("c.cars.AddVehicleModal.homeAirportHint")}
            required
            value={homeLocationId}
            onChange={(event) => setHomeLocationId(event.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.airport_code} — {location.name}
              </option>
            ))}
          </SelectField>
        </div>

        <p className="text-sm text-ink-secondary">{t("c.cars.AddVehicleModal.afterwardsHint")}</p>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
