"use client";

import { useEffect, useState } from "react";
import {
  createReservation,
  getAvailableCars,
  getLocations,
} from "@/lib/api";

type Location = {
  id: string;
  name: string;
  airport_code: string;
  address: string | null;
};

type Car = {
  id: string;
  make: string;
  model: string;
  year: number;
  license_plate: string;
  category: string | null;
  transmission: string | null;
  fuel_type: string | null;
  seats: number | null;
  price_per_day: string;
  current_location_id: string;
  status: string;
};


export default function ReservationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);

  const [pickupLocation, setPickupLocation] = useState("");
  const [returnLocation, setReturnLocation] = useState("");

  const [pickupDate, setPickupDate] = useState("");
  const [returnDate, setReturnDate] = useState("");

  const [cars, setCars] = useState<Car[]>([]);
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    getLocations()
      .then(setLocations)
      .catch(() => {
        setError("Failed to load locations.");
      });
  }, []);

  function calculateRentalDays() {
    if (!pickupDate || !returnDate) {
        return 0;
    }

    const pickup = new Date(pickupDate);
    const rentalReturn = new Date(returnDate);

    const difference =
        rentalReturn.getTime() - pickup.getTime();

    return Math.ceil(
        difference / (1000 * 60 * 60 * 24)
    );
  }

  function calculateBasePrice() {
    if (!selectedCar) {
      return 0;
    }

    return calculateRentalDays() * Number(selectedCar.price_per_day);
  }

  // Mirrors backend/app/services/pricing.py::calculate_price_breakdown —
  // this is only a pre-booking estimate shown here; the real charge is
  // computed server-side (and re-evaluated) at handover payment time.
  // Keep the two in sync if these rules change.
  const SHORT_TERM_THRESHOLD_DAYS = 5;
  const SHORT_TERM_FEE = 30;
  const AIRPORT_CHANGE_FEE = 50;

  function calculateShortTermFee() {
    const days = calculateRentalDays();
    return days > 0 && days < SHORT_TERM_THRESHOLD_DAYS ? SHORT_TERM_FEE : 0;
  }

  function calculateAirportChangeFee() {
    return pickupLocation && returnLocation && pickupLocation !== returnLocation
      ? AIRPORT_CHANGE_FEE
      : 0;
  }

  function calculateTotalPrice() {
    if (!selectedCar) {
      return 0;
    }

    return (
      calculateBasePrice() +
      calculateShortTermFee() +
      calculateAirportChangeFee()
    );
  }

  async function handleSearch() {
    if (
      !pickupLocation ||
      !returnLocation ||
      !pickupDate ||
      !returnDate
    ) {
      setError("Please complete the rental details.");
      return;
    }

    if (returnDate <= pickupDate) {
      setError("Return date must be after pickup date.");
      return;
    }

    setError("");
    setSuccess("");
    setSelectedCar(null);
    setCars([]);
    setLoading(true);

    try {
      const results = await getAvailableCars(
        pickupLocation,
        `${pickupDate}T10:00:00Z`,
        `${returnDate}T10:00:00Z`,
      );

      setCars(results);
    } catch {
      setError("Failed to search available cars.");
    } finally {
      setLoading(false);
    }
  }
  async function handleConfirmReservation() {
    if (!selectedCar) {
        setError("Please select a vehicle.");
        return;
    }

    if (
        !firstName ||
        !lastName ||
        !dateOfBirth ||
        !address ||
        !postalCode ||
        !phoneNumber ||
        !email
    ) {
        setError("Please complete all customer details.");
        return;
    }

    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
        const reservation = await createReservation({
        customer: {
            first_name: firstName,
            last_name: lastName,
            date_of_birth: dateOfBirth,
            address,
            postal_code: postalCode,
            phone_number: phoneNumber,
            email,
        },

        car_id: selectedCar.id,

        pickup_location_id: pickupLocation,
        return_location_id: returnLocation,

        pickup_at: `${pickupDate}T10:00:00Z`,
        return_at: `${returnDate}T10:00:00Z`,
        });

        setSuccess(
        `Reservation created successfully. ID: ${reservation.id}`,
        );
    } catch (error) {
        setError(
        error instanceof Error
            ? error.message
            : "Failed to create reservation.",
        );
    } finally {
        setSubmitting(false);
    }
    }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold">
          New Reservation
        </h1>

        <p className="mt-2 text-gray-600">
          Select the rental period and locations.
        </p>

        {/* Search form */}
        <div className="mt-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="grid gap-6 md:grid-cols-2">

            {/* Pickup location */}
            <div>
              <label className="block text-sm font-medium">
                Pickup location
              </label>

              <select
                value={pickupLocation}
                onChange={(e) =>
                  setPickupLocation(e.target.value)
                }
                className="mt-2 w-full rounded-lg border p-3"
              >
                <option value="">
                  Select airport
                </option>

                {locations.map((location) => (
                  <option
                    key={location.id}
                    value={location.id}
                  >
                    {location.airport_code} — {location.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Return location */}
            <div>
              <label className="block text-sm font-medium">
                Return location
              </label>

              <select
                value={returnLocation}
                onChange={(e) =>
                  setReturnLocation(e.target.value)
                }
                className="mt-2 w-full rounded-lg border p-3"
              >
                <option value="">
                  Select airport
                </option>

                {locations.map((location) => (
                  <option
                    key={location.id}
                    value={location.id}
                  >
                    {location.airport_code} — {location.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Pickup date */}
            <div>
              <label className="block text-sm font-medium">
                Pickup date
              </label>

              <input
                type="date"
                value={pickupDate}
                onChange={(e) =>
                  setPickupDate(e.target.value)
                }
                className="mt-2 w-full rounded-lg border p-3"
              />
            </div>

            {/* Return date */}
            <div>
              <label className="block text-sm font-medium">
                Return date
              </label>

              <input
                type="date"
                value={returnDate}
                onChange={(e) =>
                  setReturnDate(e.target.value)
                }
                className="mt-2 w-full rounded-lg border p-3"
              />
            </div>
          </div>

          {error && (
            <p className="mt-4 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            onClick={handleSearch}
            disabled={loading}
            className="mt-8 rounded-lg bg-black px-6 py-3 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading
              ? "Searching..."
              : "Search available cars"}
          </button>
        </div>

        {/* Available cars */}
        {cars.length > 0 && !selectedCar && (
          <div className="mt-8 space-y-4">
            <h2 className="text-xl font-semibold">
              Available Cars
            </h2>

            {cars.map((car) => (
              <div
                key={car.id}
                className="flex items-center justify-between rounded-xl bg-white p-6 shadow-sm"
              >
                <div>
                  <h3 className="text-lg font-semibold">
                    {car.make} {car.model}
                  </h3>

                  <p className="mt-1 text-sm text-gray-600">
                    {car.category} ·{" "}
                    {car.transmission} ·{" "}
                    {car.fuel_type} ·{" "}
                    {car.seats} seats
                  </p>

                  <p className="mt-2 font-medium">
                    €{car.price_per_day} / day
                  </p>

                  <p className="mt-1 text-xs text-gray-500">
                    {car.license_plate}
                  </p>
                </div>

                <button
                    onClick={() => setSelectedCar(car)}
                    className="rounded-lg bg-black px-5 py-2 text-white hover:bg-gray-800"
                    >
                    Select
                </button>
              </div>
            ))}
          </div>
        )}

        {selectedCar && (
        <div className="mt-8 rounded-xl border-2 border-black bg-white p-6">
            <h2 className="text-xl font-semibold">
            Selected Vehicle
            </h2>

            <div className="mt-4 flex items-center justify-between">
            <div>
                <h3 className="text-lg font-semibold">
                {selectedCar.make} {selectedCar.model}
                </h3>

                <p className="text-sm text-gray-600">
                {selectedCar.license_plate}
                </p>

                <p className="mt-2">
                €{selectedCar.price_per_day} / day
                </p>
            </div>

            <button
                onClick={() => setSelectedCar(null)}
                className="rounded-lg border px-4 py-2 hover:bg-gray-100"
            >
                Change
            </button>
            </div>
        </div>
        )}

        {selectedCar && (
            <div className="mt-8 rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold">
                Customer Details
                </h2>

                <div className="mt-6 grid gap-6 md:grid-cols-2">

                {/* First name */}
                <div>
                    <label className="block text-sm font-medium">
                    First name
                    </label>

                    <input
                    type="text"
                    value={firstName}
                    onChange={(e) =>
                        setFirstName(e.target.value)
                    }
                    className="mt-2 w-full rounded-lg border p-3"
                    placeholder="First name"
                    />
                </div>

                {/* Last name */}
                <div>
                    <label className="block text-sm font-medium">
                    Last name
                    </label>

                    <input
                    type="text"
                    value={lastName}
                    onChange={(e) =>
                        setLastName(e.target.value)
                    }
                    className="mt-2 w-full rounded-lg border p-3"
                    placeholder="Last name"
                    />
                </div>

                {/* Date of birth */}
                <div>
                    <label className="block text-sm font-medium">
                    Date of birth
                    </label>

                    <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) =>
                        setDateOfBirth(e.target.value)
                    }
                    className="mt-2 w-full rounded-lg border p-3"
                    />
                </div>

                {/* Postal code */}
                <div>
                    <label className="block text-sm font-medium">
                    Postal code
                    </label>

                    <input
                    type="text"
                    value={postalCode}
                    onChange={(e) =>
                        setPostalCode(e.target.value)
                    }
                    className="mt-2 w-full rounded-lg border p-3"
                    placeholder="Postal code"
                    />
                </div>

                {/* Phone number */}
                <div>
                    <label className="block text-sm font-medium">
                    Phone number
                    </label>

                    <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) =>
                        setPhoneNumber(e.target.value)
                    }
                    className="mt-2 w-full rounded-lg border p-3"
                    placeholder="+39 000 000 0000"
                    />
                </div>

                {/* Email */}
                <div>
                    <label className="block text-sm font-medium">
                    Email
                    </label>

                    <input
                    type="email"
                    value={email}
                    onChange={(e) =>
                        setEmail(e.target.value)
                    }
                    className="mt-2 w-full rounded-lg border p-3"
                    placeholder="name@example.com"
                    />
                </div>

                {/* Address */}
                <div className="md:col-span-2">
                    <label className="block text-sm font-medium">
                    Address
                    </label>

                    <input
                    type="text"
                    value={address}
                    onChange={(e) =>
                        setAddress(e.target.value)
                    }
                    className="mt-2 w-full rounded-lg border p-3"
                    placeholder="Street and house number"
                    />
                </div>

                </div>
            </div>
        )}

        {selectedCar && (
            <div className="mt-8 rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold">
                Reservation Summary
                </h2>

                <div className="mt-6 space-y-3 text-sm">

                <div className="flex justify-between">
                    <span className="text-gray-600">
                    Vehicle
                    </span>

                    <span className="font-medium">
                    {selectedCar.make} {selectedCar.model} ·{" "}
                    {selectedCar.license_plate}
                    </span>
                </div>

                <div className="flex justify-between">
                    <span className="text-gray-600">
                    Pickup
                    </span>

                    <span className="font-medium">
                    {pickupDate}
                    </span>
                </div>

                <div className="flex justify-between">
                    <span className="text-gray-600">
                    Return
                    </span>

                    <span className="font-medium">
                    {returnDate}
                    </span>
                </div>

                <div className="flex justify-between">
                    <span className="text-gray-600">
                    Rental period
                    </span>

                    <span className="font-medium">
                    {calculateRentalDays()} days
                    </span>
                </div>

                <div className="border-t pt-4">
                    <div className="flex justify-between">
                    <span className="text-gray-600">
                        Base rental
                    </span>

                    <span className="font-medium">
                        €{calculateBasePrice().toFixed(2)}
                    </span>
                    </div>

                    {calculateShortTermFee() > 0 && (
                    <div className="mt-2 flex justify-between">
                        <span className="text-gray-600">
                        Short-term rental fee
                        </span>

                        <span className="font-medium">
                        €{calculateShortTermFee().toFixed(2)}
                        </span>
                    </div>
                    )}

                    {calculateAirportChangeFee() > 0 && (
                    <div className="mt-2 flex justify-between">
                        <span className="text-gray-600">
                        Airport change fee
                        </span>

                        <span className="font-medium">
                        €{calculateAirportChangeFee().toFixed(2)}
                        </span>
                    </div>
                    )}
                </div>

                <div className="border-t pt-4">
                    <div className="flex justify-between text-lg">
                    <span className="font-semibold">
                        Total
                    </span>

                    <span className="font-bold">
                        €{calculateTotalPrice().toFixed(2)}
                    </span>
                    </div>
                </div>

                </div>
                {success && (
                    <div className="mt-6 rounded-lg bg-gray-100 p-4 text-gray-700">
                        {success}
                    </div>
                )}
                {error && (
                    <div className="mt-6 rounded-lg bg-red-50 p-4 text-red-700">
                        {error}
                    </div>
                )}
                <button
                    onClick={handleConfirmReservation}
                    disabled={submitting}
                    className="mt-6 w-full rounded-lg bg-black px-6 py-3 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                    {submitting
                        ? "Creating reservation..."
                        : "Confirm Reservation"}
                </button>
            </div>
            )}
        {/* No results */}
        {!loading &&
          !error &&
          cars.length === 0 &&
          pickupDate &&
          returnDate && (
            <p className="mt-8 text-gray-500">
              No cars found for the selected period.
            </p>
          )}
      </div>
    </main>
  );
}