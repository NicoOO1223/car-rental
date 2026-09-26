"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { CarImage } from "@/components/cars/CarImage";
import { updateCar, type Car, type Location } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";

const CATEGORY_OPTIONS = [
  "ECONOMY",
  "COMPACT",
  "MIDSIZE",
  "PREMIUM",
  "SUV",
  "VAN",
];

const TRANSMISSION_OPTIONS = ["MANUAL", "AUTOMATIC"];

const FUEL_OPTIONS = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"];

type Props = {
  car: Car;
  locations: Location[];
  onClose: () => void;
  onSaved: (updated: Car) => void;
};

export function CarEditModal({ car, locations, onClose, onSaved }: Props) {
  const [make, setMake] = useState(car.make);
  const [model, setModel] = useState(car.model);
  const [year, setYear] = useState(String(car.year));
  const [licensePlate, setLicensePlate] = useState(car.license_plate);
  const [category, setCategory] = useState(car.category ?? "");
  const [transmission, setTransmission] = useState(car.transmission ?? "");
  const [fuelType, setFuelType] = useState(car.fuel_type ?? "");
  const [seats, setSeats] = useState(car.seats != null ? String(car.seats) : "");
  const [imageUrl, setImageUrl] = useState(car.image_url ?? "");
  const [homeLocationId, setHomeLocationId] = useState(car.home_location.id);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const updated = await updateCar(car.id, {
        make,
        model,
        year: Number(year),
        license_plate: licensePlate,
        category: category || null,
        transmission: transmission || null,
        fuel_type: fuelType || null,
        seats: seats === "" ? null : Number(seats),
        image_url: imageUrl.trim() || null,
        home_location_id: homeLocationId,
      });

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.cars.CarEditModal.failedUpdateCar"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.cars.CarEditModal.editVehicle")}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.cars.CarEditModal.cancel")}</Button>
          <Button type="submit" form="car-edit-form" loading={saving}>
            {saving ? t("c.cars.CarEditModal.saving") : t("c.cars.CarEditModal.saveChanges")}
          </Button>
        </>
      }
    >
      <form id="car-edit-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("c.cars.CarEditModal.make")}
            required
            value={make}
            onChange={(event) => setMake(event.target.value)}
          />

          <TextField
            label={t("c.cars.CarEditModal.model")}
            required
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />

          <TextField
            label={t("c.cars.CarEditModal.year")}
            type="number"
            required
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />

          <TextField
            label={t("c.cars.CarEditModal.licensePlate")}
            required
            value={licensePlate}
            onChange={(event) => setLicensePlate(event.target.value)}
          />

          <SelectField
            label={t("c.cars.CarEditModal.category")}
            hint={t("c.cars.CarEditModal.drivesFallbackIllustrationBooking")}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{t("c.cars.CarEditModal.notSet")}</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <div>
            <p className="text-sm font-medium text-ink">{t("c.cars.CarEditModal.pricePerDay")}</p>

            <p className="mt-1.5 text-sm text-ink-secondary">{t("c.cars.CarEditModal.ratesManagedByAdmin", { v1: formatCurrency(car.price_per_day) })}</p>
          </div>

          <SelectField
            label={t("c.cars.CarEditModal.transmission")}
            value={transmission}
            onChange={(event) => setTransmission(event.target.value)}
          >
            <option value="">{t("c.cars.CarEditModal.notSet")}</option>
            {TRANSMISSION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={t("c.cars.CarEditModal.fuelType")}
            value={fuelType}
            onChange={(event) => setFuelType(event.target.value)}
          >
            <option value="">{t("c.cars.CarEditModal.notSet")}</option>
            {FUEL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <TextField
            label={t("c.cars.CarEditModal.seats")}
            type="number"
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />

          <SelectField
            label={t("c.cars.CarEditModal.homeAirport")}
            className="sm:col-span-2"
            hint={t("c.cars.CarEditModal.whereCarBelongsIts")}
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

        <div className="border-t border-border-subtle pt-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem] sm:items-start">
            <TextField
              label={t("c.cars.CarEditModal.photoUrl")}
              type="url"
              placeholder="https://..."
              hint={t("c.cars.CarEditModal.shownCustomersBookingFlow")}
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
            />

            <div className="sm:pt-[4.25rem]">
              <CarImage
                imageUrl={imageUrl.trim() || null}
                category={category || null}
                alt={t("c.cars.CarEditModal.vehiclePreview")}
                className="aspect-[16/9] w-full rounded-lg"
              />
            </div>
          </div>
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
