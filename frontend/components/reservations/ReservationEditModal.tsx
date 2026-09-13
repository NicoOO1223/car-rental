"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
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
      title="Edit reservation"
      size="lg"
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
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
            Rental period
          </h3>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField
              label="Pickup"
              type="datetime-local"
              required
              value={pickupAt}
              onChange={(event) => setPickupAt(event.target.value)}
            />

            <TextField
              label="Return"
              type="datetime-local"
              required
              value={returnAt}
              onChange={(event) => setReturnAt(event.target.value)}
            />

            <SelectField
              label="Pickup location"
              value={pickupLocationId}
              onChange={(event) => setPickupLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.airport_code} — {location.name}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Return location"
              value={returnLocationId}
              onChange={(event) => setReturnLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.airport_code} — {location.name}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Assigned vehicle"
              className="sm:col-span-2"
              value={carId}
              onChange={(event) => setCarId(event.target.value)}
            >
              {carOptions.map((car) => (
                <option key={car.id} value={car.id}>
                  {car.make} {car.model} — {car.license_plate}
                  {car.id === reservation.car.id ? " (current)" : ""}
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
            Customer details
          </h3>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField
              label="First name"
              required
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />

            <TextField
              label="Last name"
              required
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />

            <TextField
              label="Date of birth"
              type="date"
              required
              autoComplete="bday"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
            />

            <TextField
              label="Postal code"
              required
              autoComplete="postal-code"
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
            />

            <TextField
              label="Phone number"
              type="tel"
              required
              autoComplete="tel"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
            />

            <TextField
              label="Email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <TextField
              label="Address"
              required
              autoComplete="street-address"
              className="sm:col-span-2"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
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
