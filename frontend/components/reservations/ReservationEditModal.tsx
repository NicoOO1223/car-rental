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
import { isoToLocalInput, localInputToIso } from "@/lib/format";
import { t } from "@/lib/i18n";

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

export function ReservationEditModal({
  reservation,
  locations,
  onClose,
  onSaved,
}: Props) {
  // <input type="datetime-local"> holds a wall-clock time with no zone. Here
  // it is the time AT the place: the pickup field reads in the pickup
  // location's timezone and the return field in the return location's, not
  // in the timezone of whoever is editing.
  const [pickupAt, setPickupAt] = useState(
    isoToLocalInput(reservation.pickup_at, reservation.pickup_location.timezone),
  );
  const [returnAt, setReturnAt] = useState(
    isoToLocalInput(reservation.return_at, reservation.return_location.timezone),
  );
  const [pickupLocationId, setPickupLocationId] = useState(
    reservation.pickup_location.id,
  );
  const [returnLocationId, setReturnLocationId] = useState(
    reservation.return_location.id,
  );

  // The zone of whichever location is currently selected. A location that
  // has since been retired is missing from the list, so the reservation's
  // own copy of it covers that case.
  function zoneOf(locationId: string): string | undefined {
    return (
      locations.find((location) => location.id === locationId)?.timezone ??
      [reservation.pickup_location, reservation.return_location].find(
        (location) => location.id === locationId,
      )?.timezone
    );
  }

  const pickupZone = zoneOf(pickupLocationId);
  const returnZone = zoneOf(returnLocationId);
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
          localInputToIso(pickupAt, pickupZone),
          localInputToIso(returnAt, pickupZone),
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
  }, [pickupLocationId, pickupAt, returnAt, pickupZone]);

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
        pickup_at: localInputToIso(pickupAt, pickupZone),
        return_at: localInputToIso(returnAt, returnZone),
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
          : t("c.reservations.ReservationEditModal.failedUpdateReservation"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.reservations.ReservationEditModal.editReservation")}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.reservations.ReservationEditModal.cancel")}</Button>
          <Button
            type="submit"
            form="reservation-edit-form"
            disabled={saving}
          >
            {saving ? t("c.reservations.ReservationEditModal.saving") : t("c.reservations.ReservationEditModal.saveChanges")}
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
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">{t("c.reservations.ReservationEditModal.rentalPeriod")}</h3>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("c.reservations.ReservationEditModal.pickup")}
              type="datetime-local"
              hint={pickupZone ? t("c.reservations.ReservationEditModal.timeAtPickupLocation", { pickupZone }) : undefined}
              required
              value={pickupAt}
              onChange={(event) => setPickupAt(event.target.value)}
            />

            <TextField
              label={t("c.reservations.ReservationEditModal.return")}
              type="datetime-local"
              hint={returnZone ? t("c.reservations.ReservationEditModal.timeAtReturnLocation", { returnZone }) : undefined}
              required
              value={returnAt}
              onChange={(event) => setReturnAt(event.target.value)}
            />

            <SelectField
              label={t("c.reservations.ReservationEditModal.pickupLocation")}
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
              label={t("c.reservations.ReservationEditModal.returnLocation")}
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
              label={t("c.reservations.ReservationEditModal.assignedVehicle")}
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
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">{t("c.reservations.ReservationEditModal.customerDetails")}</h3>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("c.reservations.ReservationEditModal.firstName")}
              required
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />

            <TextField
              label={t("c.reservations.ReservationEditModal.lastName")}
              required
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />

            <TextField
              label={t("c.reservations.ReservationEditModal.dateBirth")}
              type="date"
              required
              autoComplete="bday"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
            />

            <TextField
              label={t("c.reservations.ReservationEditModal.postalCode")}
              required
              autoComplete="postal-code"
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
            />

            <TextField
              label={t("c.reservations.ReservationEditModal.phoneNumber")}
              type="tel"
              required
              autoComplete="tel"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
            />

            <TextField
              label={t("c.reservations.ReservationEditModal.email")}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <TextField
              label={t("c.reservations.ReservationEditModal.address")}
              required
              autoComplete="street-address"
              className="sm:col-span-2"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
