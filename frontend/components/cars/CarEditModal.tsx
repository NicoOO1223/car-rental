"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { CarImage } from "@/components/cars/CarImage";
import { updateCar, type Car, type Location } from "@/lib/api";

const STATUS_OPTIONS = [
  "AVAILABLE",
  "RESERVED",
  "RENTED",
  "MAINTENANCE",
  "CLEANING",
];

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
  const [pricePerDay, setPricePerDay] = useState(String(car.price_per_day));
  const [imageUrl, setImageUrl] = useState(car.image_url ?? "");
  const [locationId, setLocationId] = useState(car.current_location.id);
  const [status, setStatus] = useState(car.status);

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
        price_per_day: Number(pricePerDay),
        image_url: imageUrl.trim() || null,
        current_location_id: locationId,
        status,
      });

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update car.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="Edit vehicle"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="car-edit-form" loading={saving}>
            {saving ? "Saving" : "Save changes"}
          </Button>
        </>
      }
    >
      <form id="car-edit-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Make"
            required
            value={make}
            onChange={(event) => setMake(event.target.value)}
          />

          <TextField
            label="Model"
            required
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />

          <TextField
            label="Year"
            type="number"
            required
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />

          <TextField
            label="License plate"
            required
            value={licensePlate}
            onChange={(event) => setLicensePlate(event.target.value)}
          />

          <SelectField
            label="Category"
            hint="Drives the fallback illustration in the booking flow."
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Not set</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Price per day (EUR)"
            type="number"
            step="0.01"
            required
            value={pricePerDay}
            onChange={(event) => setPricePerDay(event.target.value)}
          />

          <SelectField
            label="Transmission"
            value={transmission}
            onChange={(event) => setTransmission(event.target.value)}
          >
            <option value="">Not set</option>
            {TRANSMISSION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Fuel type"
            value={fuelType}
            onChange={(event) => setFuelType(event.target.value)}
          >
            <option value="">Not set</option>
            {FUEL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Seats"
            type="number"
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />

          <SelectField
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Current location"
            className="sm:col-span-2"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
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
              label="Photo URL"
              type="url"
              placeholder="https://..."
              hint="Shown to customers in the booking flow. Leave empty to use the category illustration."
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
            />

            <div className="sm:pt-[4.25rem]">
              <CarImage
                imageUrl={imageUrl.trim() || null}
                category={category || null}
                alt="Vehicle preview"
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
