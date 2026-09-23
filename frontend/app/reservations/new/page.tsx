"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CarFront,
  CheckCircle2,
  SearchX,
} from "lucide-react";

import {
  createReservation,
  getAvailableCars,
  getExtras,
  getLocations,
  quoteReservation,
  type Car,
  type Extra,
  type ExtraSelection,
  type Location,
  type Reservation,
  type ReservationQuote,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select, SelectField } from "@/components/ui/Field";
import { PageShell } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { PriceBreakdownList } from "@/components/pricing/PriceBreakdownList";
import { BookingSummary } from "@/components/booking/BookingSummary";
import { CustomerStep, EMPTY_CUSTOMER, type CustomerDetails } from "@/components/booking/CustomerStep";
import { ExtrasPicker } from "@/components/booking/ExtrasPicker";
import { VehicleCard } from "@/components/booking/VehicleCard";
import {
  Stepper,
  stepIndex,
  type BookingStep,
} from "@/components/booking/Stepper";
import { DateRangeCalendar, toDateKey } from "@/components/booking/DateRangeCalendar";
import { IdentityVerificationStep } from "@/components/identity/IdentityVerificationStep";
import { CarImage } from "@/components/cars/CarImage";
import { categoryLabel } from "@/lib/carDisplay";
import {
  TIME_SLOTS,
  bookingReference,
  formatCurrency,
  formatDateTime,
  formatTimeSlot,
  localInputToIso,
  rentalDays,
} from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";

type SortKey = "price-asc" | "price-desc" | "name";

/** A sensible default window: tomorrow to three days later, at 10:00. */
function defaultRange() {
  const start = new Date();
  start.setDate(start.getDate() + 1);

  const end = new Date(start);
  end.setDate(end.getDate() + 3);

  return {
    pickupDate: toDateKey(start),
    returnDate: toDateKey(end),
    pickupTime: "10:00",
    returnTime: "10:00",
  };
}

export default function NewReservationPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<BookingStep>("search");
  const [furthest, setFurthest] = useState<BookingStep>("search");

  // --- Search ---
  const [locations, setLocations] = useState<Location[]>([]);
  const [pickupLocationId, setPickupLocationId] = useState("");
  const [returnLocationId, setReturnLocationId] = useState("");
  const initialRange = useMemo(() => defaultRange(), []);
  const [pickupDate, setPickupDate] = useState(initialRange.pickupDate);
  const [returnDate, setReturnDate] = useState(initialRange.returnDate);
  const [pickupTime, setPickupTime] = useState(initialRange.pickupTime);
  const [returnTime, setReturnTime] = useState(initialRange.returnTime);
  const [searchError, setSearchError] = useState("");

  // --- Vehicles ---
  const [cars, setCars] = useState<Car[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [transmissionFilter, setTransmissionFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("price-asc");

  // --- Extras ---
  const [extras, setExtras] = useState<Extra[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<ExtraSelection[]>([]);

  // --- Customer ---
  const [customer, setCustomer] = useState<CustomerDetails>(EMPTY_CUSTOMER);
  const [customerErrors, setCustomerErrors] = useState<
    Partial<Record<keyof CustomerDetails, string>>
  >({});

  // --- Quote (server-computed; nothing here recomputes a price) ---
  const [quote, setQuote] = useState<ReservationQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  // --- Confirmation ---
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<Reservation | null>(null);
  const [identityVerification, setIdentityVerification] = useState<
    Reservation["customer"]["identity_verification"]
  >(null);

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const [locationData, extraData] = await Promise.all([
          getLocations(),
          getExtras(),
        ]);

        setLocations(locationData);
        setExtras(extraData);
      } catch {
        setSearchError("Failed to load booking options. Please refresh.");
      }
    }

    load();
  }, []);

  const pickupLocation =
    locations.find((location) => location.id === pickupLocationId) ?? null;
  const returnLocation =
    locations.find((location) => location.id === returnLocationId) ?? null;

  // The calendar owns the days and the selects own the clock time; the
  // two are only recombined here, at the edge where the API needs an
  // instant.
  const pickupLocal = pickupDate ? `${pickupDate}T${pickupTime}` : "";
  const returnLocal = returnDate ? `${returnDate}T${returnTime}` : "";

  const pickupIso = pickupLocal ? localInputToIso(pickupLocal) : "";
  const returnIso = returnLocal ? localInputToIso(returnLocal) : "";
  const days = pickupIso && returnIso ? rentalDays(pickupIso, returnIso) : 0;

  function goTo(next: BookingStep) {
    setStep(next);

    if (stepIndex(next) > stepIndex(furthest)) {
      setFurthest(next);
    }

    contentRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // --- Search -------------------------------------------------------------

  async function handleSearch() {
    if (!pickupLocationId || !returnLocationId) {
      setSearchError("Choose a pickup and return location.");
      return;
    }

    if (!pickupDate || !returnDate) {
      setSearchError("Pick a pickup and a drop-off date on the calendar.");
      return;
    }

    if (new Date(returnLocal) <= new Date(pickupLocal)) {
      setSearchError("The drop-off must be after the pickup.");
      return;
    }

    setSearchError("");
    setSearching(true);
    setSelectedCar(null);
    setQuote(null);

    try {
      const results = await getAvailableCars(
        pickupLocationId,
        pickupIso,
        returnIso,
      );

      setCars(results);
      goTo("vehicle");
    } catch {
      setSearchError("Failed to search for available cars. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  // --- Quoting ------------------------------------------------------------
  //
  // Debounced so adjusting a quantity stepper does not fire a request per
  // click. Late responses are discarded via the token, so a slow earlier
  // request can never overwrite a newer price.

  const requestToken = useRef(0);

  const refreshQuote = useCallback(async () => {
    if (!selectedCar || !pickupIso || !returnIso) return;

    const token = ++requestToken.current;

    setQuoting(true);
    setQuoteError("");

    try {
      const result = await quoteReservation({
        car_id: selectedCar.id,
        pickup_location_id: pickupLocationId,
        return_location_id: returnLocationId,
        pickup_at: pickupIso,
        return_at: returnIso,
        extras: selectedExtras,
      });

      if (token === requestToken.current) {
        setQuote(result);
      }
    } catch (error) {
      if (token === requestToken.current) {
        setQuoteError(
          error instanceof Error ? error.message : "Failed to price this booking.",
        );
      }
    } finally {
      if (token === requestToken.current) {
        setQuoting(false);
      }
    }
  }, [
    selectedCar,
    pickupIso,
    returnIso,
    pickupLocationId,
    returnLocationId,
    selectedExtras,
  ]);

  useEffect(() => {
    if (!selectedCar) return;

    const timer = window.setTimeout(refreshQuote, 250);

    return () => window.clearTimeout(timer);
  }, [selectedCar, refreshQuote]);

  // --- Vehicle list -------------------------------------------------------

  const categories = useMemo(() => {
    const found = new Set<string>();
    for (const car of cars) {
      if (car.category) found.add(car.category);
    }
    return [...found].sort();
  }, [cars]);

  const transmissions = useMemo(() => {
    const found = new Set<string>();
    for (const car of cars) {
      if (car.transmission) found.add(car.transmission);
    }
    return [...found].sort();
  }, [cars]);

  const visibleCars = useMemo(() => {
    const filtered = cars.filter((car) => {
      if (categoryFilter !== "ALL" && car.category !== categoryFilter) {
        return false;
      }
      if (
        transmissionFilter !== "ALL" &&
        car.transmission !== transmissionFilter
      ) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered];

    sorted.sort((a, b) => {
      if (sortKey === "name") {
        return `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`);
      }

      const diff = Number(a.price_per_day) - Number(b.price_per_day);
      return sortKey === "price-desc" ? -diff : diff;
    });

    return sorted;
  }, [cars, categoryFilter, transmissionFilter, sortKey]);

  /**
   * The per-card total. This is a display estimate for comparing vehicles
   * and is intentionally the only arithmetic in this file: quoting every
   * listed car individually would be one request per card. The moment a
   * car is selected the server's quote takes over, and that is the figure
   * the customer confirms and is charged.
   */
  function cardTotal(car: Car): number | null {
    if (days <= 0) return null;
    return Number(car.price_per_day) * days;
  }

  // --- Confirmation -------------------------------------------------------

  function validateCustomer(): boolean {
    const required: (keyof CustomerDetails)[] = [
      "first_name",
      "last_name",
      "date_of_birth",
      "address",
      "postal_code",
    ];

    const errors: Partial<Record<keyof CustomerDetails, string>> = {};

    for (const key of required) {
      if (!customer[key].trim()) {
        errors[key] = "Required";
      }
    }

    if (customer.email && !customer.email.includes("@")) {
      errors.email = "Enter a valid email address.";
    }

    setCustomerErrors(errors);

    return Object.keys(errors).length === 0;
  }

  async function handleConfirm() {
    if (!selectedCar) return;

    setSubmitting(true);
    setSubmitError("");

    try {
      const reservation = await createReservation({
        customer: {
          first_name: customer.first_name,
          last_name: customer.last_name,
          date_of_birth: customer.date_of_birth,
          address: customer.address,
          postal_code: customer.postal_code,
          phone_number: customer.phone_number,
          email: customer.email,
        },
        car_id: selectedCar.id,
        pickup_location_id: pickupLocationId,
        return_location_id: returnLocationId,
        pickup_at: pickupIso,
        return_at: returnIso,
        extras: selectedExtras,
      });

      setCreated(reservation);
      setIdentityVerification(reservation.customer.identity_verification);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to create reservation.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // --- Confirmation screen ------------------------------------------------

  if (created) {
    return (
      <PageShell width="narrow">
        <div className="rounded-xl bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white">
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Reservation confirmed
          </h1>

          <p className="mx-auto mt-2 max-w-sm text-ink-secondary">
            {created.customer.first_name} {created.customer.last_name} is booked
            into the {created.car.make} {created.car.model}.
          </p>

          <dl className="mt-6 space-y-2.5 rounded-lg bg-surface-sunken p-4 text-left text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Booking reference</dt>
              <dd className="font-mono text-xs font-medium text-ink">
                {bookingReference(created.id)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Pickup</dt>
              <dd className="text-right font-medium text-ink">
                {formatDateTime(created.pickup_at)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Return</dt>
              <dd className="text-right font-medium text-ink">
                {formatDateTime(created.return_at)}
              </dd>
            </div>
            {quote && (
              <div className="flex justify-between gap-4 border-t border-border-strong pt-2.5">
                <dt className="text-ink-muted">Total</dt>
                <dd className="font-semibold text-ink">
                  {formatCurrency(quote.total_amount)}
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-6 rounded-lg bg-surface-sunken p-4 text-left">
            <h2 className="text-sm font-semibold text-ink">
              Verify your identity now (optional)
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              Speed up pickup by verifying your driving licence ahead of
              time. You can also do this in person when you collect the
              car.
            </p>
            <div className="mt-3">
              <IdentityVerificationStep
                customerId={created.customer.id}
                identityVerification={identityVerification}
                onUpdate={setIdentityVerification}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button
              onClick={() => navigate(`/reservations/manage/${created.id}`)}
            >
              View reservation
            </Button>

            <Button
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              Start another booking
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  // --- Wizard -------------------------------------------------------------

  const showSummary = step !== "search";

  return (
    <PageShell width="wide">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">
          New reservation
        </h1>
        <p className="mt-2 text-ink-secondary">
          Find a vehicle, add any extras, and confirm the booking.
        </p>
      </div>

      <Stepper current={step} furthest={furthest} onStepClick={goTo} />

      <div
        ref={contentRef}
        className={
          showSummary
            ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start"
            : ""
        }
      >
        <div className="min-w-0">
          {step === "search" && (
            <div className="rounded-xl bg-surface p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-ink">
                Where and when
              </h2>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <SelectField
                  label="Pickup location"
                  required
                  value={pickupLocationId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setPickupLocationId(next);
                    // Most rentals are round trips, so mirror the return
                    // location rather than making it a second empty
                    // required field.
                    if (!returnLocationId || returnLocationId === pickupLocationId) {
                      setReturnLocationId(next);
                    }
                  }}
                >
                  <option value="">Select an airport</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.airport_code} — {location.name}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label="Return location"
                  required
                  hint={
                    returnLocationId && returnLocationId !== pickupLocationId
                      ? "A one-way rental adds an airport change fee."
                      : undefined
                  }
                  value={returnLocationId}
                  onChange={(event) => setReturnLocationId(event.target.value)}
                >
                  <option value="">Select an airport</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.airport_code} — {location.name}
                    </option>
                  ))}
                </SelectField>

              </div>

              <div className="mt-6">
                <p className="mb-2 text-sm font-medium text-ink">
                  Rental dates
                  <span className="ml-0.5 text-ink-muted" aria-hidden="true">
                    *
                  </span>
                </p>

                <DateRangeCalendar
                  pickupDate={pickupDate}
                  returnDate={returnDate}
                  dayCount={days}
                  onChange={(next) => {
                    setPickupDate(next.pickupDate);
                    setReturnDate(next.returnDate);
                  }}
                />

              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <SelectField
                  label="Pickup time"
                  required
                  value={pickupTime}
                  onChange={(event) => setPickupTime(event.target.value)}
                >
                  {TIME_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {formatTimeSlot(slot)}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label="Drop-off time"
                  required
                  value={returnTime}
                  onChange={(event) => setReturnTime(event.target.value)}
                >
                  {TIME_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {formatTimeSlot(slot)}
                    </option>
                  ))}
                </SelectField>
              </div>

              {searchError && (
                <p className="mt-4 text-sm text-red-600" role="alert">
                  {searchError}
                </p>
              )}

              {/* The duration already appears in the range read-out
                  above, so this row is just the action. */}
              <div className="mt-6 flex justify-end">
                <Button
                  size="lg"
                  loading={searching}
                  onClick={handleSearch}
                >
                  {searching ? "Searching" : "Search vehicles"}
                  {!searching && (
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === "vehicle" && (
            <div>
              <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-ink-secondary">
                  <span className="font-semibold text-ink">
                    {visibleCars.length}
                  </span>{" "}
                  {visibleCars.length === 1 ? "vehicle" : "vehicles"} available
                  {visibleCars.length !== cars.length && ` of ${cars.length}`}
                </p>

                {/* Each control is width-constrained by its wrapper rather
                    than by a class on the Select, because the shared
                    control style is w-full and would win the tie. */}
                <div className="flex flex-wrap gap-2">
                  {categories.length > 1 && (
                    <div className="w-40">
                      <Select
                        aria-label="Filter by category"
                        value={categoryFilter}
                        onChange={(event) =>
                          setCategoryFilter(event.target.value)
                        }
                        className="py-2 text-sm"
                      >
                        <option value="ALL">All categories</option>
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {categoryLabel(category)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}

                  {transmissions.length > 1 && (
                    <div className="w-40">
                      <Select
                        aria-label="Filter by transmission"
                        value={transmissionFilter}
                        onChange={(event) =>
                          setTransmissionFilter(event.target.value)
                        }
                        className="py-2 text-sm"
                      >
                        <option value="ALL">Any transmission</option>
                        {transmissions.map((transmission) => (
                          <option key={transmission} value={transmission}>
                            {transmission === "MANUAL" ? "Manual" : "Automatic"}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}

                  <div className="w-44">
                    <Select
                      aria-label="Sort vehicles"
                      value={sortKey}
                      onChange={(event) =>
                        setSortKey(event.target.value as SortKey)
                      }
                      className="py-2 text-sm"
                    >
                      <option value="price-asc">Price: low to high</option>
                      <option value="price-desc">Price: high to low</option>
                      <option value="name">Name</option>
                    </Select>
                  </div>
                </div>
              </div>

              {searching ? (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div
                      key={index}
                      className="overflow-hidden rounded-xl bg-surface shadow-sm"
                    >
                      <Skeleton className="aspect-[16/9] w-full rounded-none" />
                      <div className="p-5">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="mt-3 h-3 w-48" />
                        <Skeleton className="mt-5 h-7 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : visibleCars.length === 0 ? (
                <EmptyState
                  icon={cars.length === 0 ? SearchX : CarFront}
                  title={
                    cars.length === 0
                      ? "No vehicles available"
                      : "No vehicles match those filters"
                  }
                  description={
                    cars.length === 0
                      ? "Nothing is free at that location for the dates you chose. Try a different window."
                      : "Clear a filter to see the rest of what is available."
                  }
                  action={
                    cars.length === 0 ? (
                      <Button variant="secondary" onClick={() => goTo("search")}>
                        Change search
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setCategoryFilter("ALL");
                          setTransmissionFilter("ALL");
                        }}
                      >
                        Clear filters
                      </Button>
                    )
                  }
                />
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleCars.map((car) => (
                    <VehicleCard
                      key={car.id}
                      car={car}
                      totalAmount={cardTotal(car)}
                      rentalDays={days}
                      selected={selectedCar?.id === car.id}
                      onSelect={() => setSelectedCar(car)}
                    />
                  ))}
                </div>
              )}

              <StepNav
                onBack={() => goTo("search")}
                onNext={() => goTo("extras")}
                nextDisabled={!selectedCar}
                nextHint={!selectedCar ? "Select a vehicle to continue" : undefined}
              />
            </div>
          )}

          {step === "extras" && (
            <div>
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-ink">
                  Add extras
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  Optional. Everything here can also be added at the counter.
                </p>
              </div>

              <ExtrasPicker
                extras={extras}
                selections={selectedExtras}
                onChange={setSelectedExtras}
              />

              <StepNav
                onBack={() => goTo("vehicle")}
                onNext={() => goTo("customer")}
                nextLabel={
                  selectedExtras.length === 0 ? "Skip extras" : "Continue"
                }
              />
            </div>
          )}

          {step === "customer" && (
            <div>
              <CustomerStep
                value={customer}
                onChange={setCustomer}
                errors={customerErrors}
              />

              <StepNav
                onBack={() => goTo("extras")}
                onNext={() => {
                  if (validateCustomer()) goTo("review");
                }}
              />
            </div>
          )}

          {step === "review" && selectedCar && (
            <div className="space-y-5">
              <div className="rounded-xl bg-surface p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Review</h2>

                <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
                  <CarImage
                    imageUrl={selectedCar.image_url}
                    category={selectedCar.category}
                    alt={`${selectedCar.make} ${selectedCar.model}`}
                    className="aspect-[16/9] w-full rounded-lg sm:w-44"
                  />

                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {selectedCar.make} {selectedCar.model}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {selectedCar.license_plate}
                    </p>
                    <p className="mt-2 text-sm text-ink-secondary">
                      {formatDateTime(pickupIso)}
                    </p>
                    <p className="text-sm text-ink-secondary">
                      to {formatDateTime(returnIso)}
                    </p>
                  </div>
                </div>

                <div className="mt-6 border-t border-border-subtle pt-5">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
                    Driver
                  </h3>
                  <p className="mt-2 font-medium text-ink">
                    {customer.first_name} {customer.last_name}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {customer.address}, {customer.postal_code}
                  </p>
                  {customer.email && (
                    <p className="text-sm text-ink-muted">{customer.email}</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl bg-surface p-6 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
                  Price
                </h3>

                {quote ? (
                  <PriceBreakdownList
                    breakdown={quote}
                    totalLabel="Total due at pickup"
                    className="mt-4"
                  />
                ) : (
                  <div className="mt-4 space-y-2.5">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                )}
              </div>

              {submitError && (
                <p className="text-sm text-red-600" role="alert">
                  {submitError}
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <Button variant="secondary" onClick={() => goTo("customer")}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>

                <Button
                  size="lg"
                  loading={submitting}
                  disabled={!quote || !quote.car_available}
                  onClick={handleConfirm}
                >
                  {submitting ? "Confirming" : "Confirm reservation"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {showSummary && (
          <BookingSummary
            pickupLocation={pickupLocation}
            returnLocation={returnLocation}
            pickupAt={pickupIso}
            returnAt={returnIso}
            car={selectedCar}
            quote={quote}
            quoting={quoting}
            quoteError={quoteError}
          />
        )}
      </div>
    </PageShell>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
  nextHint,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextHint?: string;
}) {
  return (
    <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="secondary" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Button>

      <div className="flex items-center gap-3 sm:justify-end">
        {nextHint && (
          <p className="text-sm text-ink-muted">{nextHint}</p>
        )}

        <Button disabled={nextDisabled} onClick={onNext}>
          {nextLabel}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
