"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import {
  getAvailableCars,
  updateReservation,
  type Reservation,
  type Location,
} from "@/lib/api";

type CarOption = {
  id: string;
  make: string;
  model: string;
  license_plate: string;
};

type Props = {
  reservation: Reservation;
  locations: Location[];
  onClose: () => void;
  onSaved: (updated: Reservation) => void;
};

const inputClass = "mt-2 w-full rounded-lg border p-3";
const labelClass = "block text-sm font-medium";

// The backend stores/accepts UTC ISO timestamps; <input type="datetime-local">
// works with a local, timezone-less string. These helpers convert between them.
function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

export function ReservationEditModal({
  reservation,
  locations,
  onClose,
  onSaved,
}: Props) {
  const [pickupAt, setPickupAt] = useState(
    isoToLocalInput(reservation.pickup_at),
  );
  const [returnAt, setReturnAt] = useState(
    isoToLocalInput(reservation.return_at),
  );
  const [pickupLocationId, setPickupLocationId] = useState(
    reservation.pickup_location.id,
  );
  const [returnLocationId, setReturnLocationId] = useState(
    reservation.return_location.id,
  );
  const [carId, setCarId] = useState(reservation.car.id);

  const [firstName, setFirstName] = useState(
    reservation.customer.first_name,
  );
  const [lastName, setLastName] = useState(
    reservation.customer.last_name,
  );
  const [dateOfBirth, setDateOfBirth] = useState(
    reservation.customer.date_of_birth,
  );
  const [address, setAddress] = useState(reservation.customer.address);
  const [postalCode, setPostalCode] = useState(
    reservation.customer.postal_code,
  );
  const [phoneNumber, setPhoneNumber] = useState(
    reservation.customer.phone_number ?? "",
  );
  const [email, setEmail] = useState(reservation.customer.email ?? "");

  const [availableCars, setAvailableCars] = useState<CarOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAvailableCars() {
      if (!pickupLocationId || !pickupAt || !returnAt) {
        return;
      }

      try {
        const cars: CarOption[] = await getAvailableCars(
          pickupLocationId,
          localInputToIso(pickupAt),
          localInputToIso(returnAt),
        );

        if (!cancelled) {
          setAvailableCars(cars);
        }
      } catch {
        // Leave the previous list in place on failure — the currently
        // assigned car is always merged in below regardless.
      }
    }

    loadAvailableCars();

    return () => {
      cancelled = true;
    };
  }, [pickupLocationId, pickupAt, returnAt]);

  const currentCarOption: CarOption = {
    id: reservation.car.id,
    make: reservation.car.make,
    model: reservation.car.model,
    license_plate: reservation.car.license_plate,
  };

  const carOptions = availableCars.some(
    (car) => car.id === currentCarOption.id,
  )
    ? availableCars
    : [currentCarOption, ...availableCars];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const updated = await updateReservation(reservation.id, {
        pickup_at: localInputToIso(pickupAt),
        return_at: localInputToIso(returnAt),
        pickup_location_id: pickupLocationId,
        return_location_id: returnLocationId,
        car_id: carId,
        customer: {
          first_name: firstName,
          last_name: lastName,
          date_of_birth: dateOfBirth,
          address,
          postal_code: postalCode,
          phone_number: phoneNumber,
          email,
        },
      });

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update reservation.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="Edit Reservation"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="reservation-edit-form"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </>
      }
    >
      <form
        id="reservation-edit-form"
        onSubmit={handleSubmit}
        className="space-y-6"
      >
        <div>
          <h3 className="text-sm font-semibold text-gray-500">
            Rental period
          </h3>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Pickup</label>
              <input
                type="datetime-local"
                value={pickupAt}
                onChange={(e) => setPickupAt(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Return</label>
              <input
                type="datetime-local"
                value={returnAt}
                onChange={(e) => setReturnAt(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Pickup location</label>
              <select
                value={pickupLocationId}
                onChange={(e) => setPickupLocationId(e.target.value)}
                className={inputClass}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.airport_code} — {location.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Return location</label>
              <select
                value={returnLocationId}
                onChange={(e) => setReturnLocationId(e.target.value)}
                className={inputClass}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.airport_code} — {location.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className={labelClass}>Assigned vehicle</label>
              <select
                value={carId}
                onChange={(e) => setCarId(e.target.value)}
                className={inputClass}
              >
                {carOptions.map((car) => (
                  <option key={car.id} value={car.id}>
                    {car.make} {car.model} — {car.license_plate}
                    {car.id === reservation.car.id ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-500">
            Customer details
          </h3>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>First name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Last name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Date of birth</label>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Postal code</label>
              <input
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Phone number</label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className={labelClass}>Address</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={inputClass}
                required
              />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
