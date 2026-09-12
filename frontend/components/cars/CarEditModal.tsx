"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { updateCar, type Car, type Location } from "@/lib/api";

const STATUS_OPTIONS = [
  "AVAILABLE",
  "RESERVED",
  "RENTED",
  "MAINTENANCE",
  "CLEANING",
];

type Props = {
  car: Car;
  locations: Location[];
  onClose: () => void;
  onSaved: (updated: Car) => void;
};

const inputClass = "mt-2 w-full rounded-lg border p-3";
const labelClass = "block text-sm font-medium";

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
        current_location_id: locationId,
        status,
      });

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update car.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="Edit Vehicle"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="car-edit-form" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </>
      }
    >
      <form
        id="car-edit-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Make</label>
            <input
              value={make}
              onChange={(e) => setMake(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Model</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>License Plate</label>
            <input
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Price / Day (€)</label>
            <input
              type="number"
              step="0.01"
              value={pricePerDay}
              onChange={(e) => setPricePerDay(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Transmission</label>
            <input
              value={transmission}
              onChange={(e) => setTransmission(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Fuel Type</label>
            <input
              value={fuelType}
              onChange={(e) => setFuelType(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Seats</label>
            <input
              type="number"
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputClass}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Current Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={inputClass}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.airport_code} — {location.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
      </form>
    </Modal>
  );
}
