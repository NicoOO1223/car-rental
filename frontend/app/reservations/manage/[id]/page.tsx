"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Pencil, Undo2 } from "lucide-react";

import {
  getReservation,
  getLocations,
  getCheckOut,
  getHandover,
  downloadAgreement,
  cancelReservation,
  updateReservationStatus,
  type Reservation,
  type Location,
  type CheckOut,
  type Handover,
} from "@/lib/api";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ReservationEditModal } from "@/components/reservations/ReservationEditModal";
import { SkeletonDetailPage } from "@/components/ui/Skeleton";
import {
  bookingReference,
  formatCurrency,
  formatDate,
  formatNumber,
  formatTime,
} from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

const EDITABLE_STATUSES = new Set(["PENDING", "CONFIRMED", "ACTIVE"]);

export default function ReservationDetailsPage({
  params,
}: Props) {
  const navigate = useNavigate();
  const [reservation, setReservation] =
    useState<Reservation | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [checkOut, setCheckOut] = useState<CheckOut | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

 const [cancelling, setCancelling] = useState(false);
 const [updatingStatus, setUpdatingStatus] = useState(false);
 const [editing, setEditing] = useState(false);
 const [showApproval, setShowApproval] = useState(false);
 const [showCheckOut, setShowCheckOut] = useState(false);

 const [actionError, setActionError] = useState("");
  useEffect(() => {
    async function loadReservation() {
      try {
        const { id } = await params;

        const [data, locationData] = await Promise.all([
          getReservation(id),
          getLocations(),
        ]);

        setReservation(data);
        setLocations(locationData);

        // A handover only exists once a reservation reaches CONFIRMED.
        // Asking for one on a PENDING booking is a guaranteed 400, so
        // skip the request rather than firing it and swallowing the
        // error — it was logging a console error on every pending
        // reservation anyone opened. CANCELLED is included despite that
        // same risk (a reservation cancelled while still PENDING never
        // got one either) because a reservation that reached the
        // counter, paid, and was *then* cancelled keeps its Handover
        // row — that's exactly where refund status lives. The catch
        // handles both the genuine race and the no-handover case.
        if (["CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED"].includes(data.status)) {
          try {
            setHandover(await getHandover(id));
          } catch {
            setHandover(null);
          }
        } else {
          setHandover(null);
        }

        // Only a returned rental has a completed check-out to show.
        if (data.status === "COMPLETED") {
          try {
            setCheckOut(await getCheckOut(id));
          } catch {
            setCheckOut(null);
          }
        }
      } catch {
        setError("Failed to load reservation.");
      } finally {
        setLoading(false);
      }
    }

    loadReservation();
  }, [params]);

  // Dates and times come from lib/format.ts. Pickup and return are shown in
  // the timezone of the location they happen at (passed at each call).
  function formatDateTime(date: string, timeZone?: string) {
    return `${formatDate(date, timeZone)} at ${formatTime(date, timeZone)}`;
  }

  function getRentalDays(
    pickup: string,
    returnDate: string
  ) {
    const pickupDate = new Date(pickup);
    const returnAt = new Date(returnDate);

    const difference =
      returnAt.getTime() - pickupDate.getTime();

    return Math.ceil(
      difference / (1000 * 60 * 60 * 24)
    );
  }

  async function handleCancelReservation() {
    if (!reservation) {
      return;
    }

    const willRefund = handover?.payment_status === "SUCCEEDED";
    const confirmationMessage = willRefund
      ? `Are you sure you want to cancel this reservation? This will also refund ${formatCurrency(
          handover!.payment_amount ?? 0,
          handover!.payment_currency ?? undefined,
        )} to the customer via ${handover!.payment_method === "CASH" ? "cash" : "card"}.`
      : "Are you sure you want to cancel this reservation?";

    const confirmed = window.confirm(confirmationMessage);

    if (!confirmed) {
      return;
    }

    setCancelling(true);
    setActionError("");

    try {
      const updatedReservation =
        await cancelReservation(reservation.id);

      setReservation(updatedReservation);

      if (willRefund) {
        setHandover(await getHandover(reservation.id));
      }
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Failed to cancel reservation."
      );
    } finally {
      setCancelling(false);
    }
  }
  
  async function handleStatusChange(
  newStatus: "CONFIRMED" | "COMPLETED",
) {
  if (!reservation) {
    return;
  }

  const action =
    newStatus === "CONFIRMED"
      ? "approve this reservation"
      : "complete this rental";

  const confirmed = window.confirm(
    `Are you sure you want to ${action}?`,
  );

  if (!confirmed) {
    return;
  }

  setUpdatingStatus(true);
  setActionError("");

  try {
    const updatedReservation =
      await updateReservationStatus(
        reservation.id,
        newStatus,
      );

    setReservation(updatedReservation);
  } catch (error) {
    setActionError(
      error instanceof Error
        ? error.message
        : "Failed to update reservation status.",
    );
  } finally {
    setUpdatingStatus(false);
  }
}

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <SkeletonDetailPage />
      </main>
    );
  }

  if (error || !reservation) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-red-600">
            {error || "Reservation not found."}
          </p>
        </div>
      </main>
    );
  }

  const rentalDays = getRentalDays(
    reservation.pickup_at,
    reservation.return_at
  );

  return (
    <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div className="mb-8">

          <button
            onClick={() =>
              navigate("/reservations/manage")
            }
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to reservations
          </button>

          <div className="mt-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">
                  Reservation
                </h1>

                <ReservationStatusBadge status={reservation.status} />

                {EDITABLE_STATUSES.has(reservation.status) && (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                )}
              </div>

              <p className="mt-2 text-sm text-ink-muted">
                Booking{" "}
                <span className="font-mono text-ink-secondary">
                  {bookingReference(reservation.id)}
                </span>
              </p>
            </div>

            <div className="text-left md:text-right">
              <p className="text-sm text-gray-500">
                Rental duration
              </p>

              <p className="text-2xl font-semibold">
                {rentalDays}{" "}
                {rentalDays === 1 ? "day" : "days"}
              </p>
            </div>

          </div>
        </div>

        {/* Main grid */}
        <div className="grid gap-6 lg:grid-cols-3">

          {/* Left / main content */}
          <div className="space-y-6 lg:col-span-2">

            {/* Customer */}
            <section className="rounded-xl bg-surface p-6 shadow-sm">

              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Customer
                </h2>

                <button
                  onClick={() =>
                    navigate(`/customers/${reservation.customer.id}`)
                  }
                  className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-black"
                >
                  View customer
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 flex items-center gap-4">

                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold">
                  {reservation.customer.first_name
                    .charAt(0)}
                  {reservation.customer.last_name
                    .charAt(0)}
                </div>

                <div>
                  <p className="text-lg font-medium">
                    {reservation.customer.first_name}{" "}
                    {reservation.customer.last_name}
                  </p>

                  <p className="mt-1 text-sm text-gray-500">
                    Customer for this reservation
                  </p>
                </div>

              </div>
            </section>

            {/* Vehicle */}
            <section className="rounded-xl bg-surface p-6 shadow-sm">

              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Vehicle
                </h2>

                <button
                  onClick={() =>
                    navigate(`/cars/${reservation.car.id}`)
                  }
                  className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-black"
                >
                  View vehicle
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

                <div>
                  <p className="text-xl font-semibold">
                    {reservation.car.make}{" "}
                    {reservation.car.model}
                  </p>

                  <p className="mt-1 text-sm text-gray-500">
                    {reservation.car.license_plate}
                  </p>
                </div>

                <div className="rounded-lg bg-gray-50 px-4 py-3">
                  <p className="text-xs text-gray-500">
                    Assigned vehicle
                  </p>

                  <p className="mt-1 font-medium">
                    {reservation.car.license_plate}
                  </p>
                </div>

              </div>
            </section>

            {/* Extras — only rendered when the booking has any, so a
                plain booking does not gain an empty panel. */}
            {reservation.extras.length > 0 && (
              <section className="rounded-xl bg-surface p-6 shadow-sm">
                <h2 className="text-lg font-semibold">Extras</h2>

                <p className="mt-1 text-sm text-gray-500">
                  Booked add-ons, at the prices they were booked at.
                </p>

                <ul className="mt-5 divide-y divide-gray-100">
                  {reservation.extras.map((line) => (
                    <li
                      key={line.extra_id}
                      className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">
                          {line.name}
                          {line.quantity > 1 && (
                            <span className="text-gray-500">
                              {" × "}
                              {line.quantity}
                            </span>
                          )}
                        </p>

                        <p className="mt-0.5 text-sm text-gray-500">
                          {formatCurrency(line.unit_price)}
                          {line.price_unit === "PER_DAY"
                            ? " per day"
                            : " one-off"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Rental timeline */}
            <section className="rounded-xl bg-surface p-6 shadow-sm">

              <h2 className="text-lg font-semibold">
                Rental timeline
              </h2>

              <div className="mt-6">

                {/* Pickup */}
                <div className="flex gap-4">

                  <div className="flex flex-col items-center">

                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white">
                      <Check className="h-4 w-4" />
                    </div>

                    <div className="mt-2 h-16 w-px bg-gray-200" />

                  </div>

                  <div className="pb-6">

                    <p className="text-sm font-medium text-gray-500">
                      PICKUP
                    </p>

                    <p className="mt-1 text-lg font-semibold">
                      {reservation.pickup_location.name}
                    </p>

                    <p className="mt-1 text-sm text-gray-600">
                      {formatDateTime(
                        reservation.pickup_at, reservation.pickup_location.timezone
                      )}
                    </p>

                    <span className="mt-2 inline-block rounded-md bg-gray-100 px-2 py-1 text-xs font-medium">
                      {
                        reservation.pickup_location
                          .airport_code
                      }
                    </span>

                  </div>

                </div>

                {/* Return */}
                <div className="flex gap-4">

                  <div className="flex flex-col items-center">

                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                      <Undo2 className="h-4 w-4" />
                    </div>

                  </div>

                  <div>

                    <p className="text-sm font-medium text-gray-500">
                      RETURN
                    </p>

                    <p className="mt-1 text-lg font-semibold">
                      {reservation.return_location.name}
                    </p>

                    <p className="mt-1 text-sm text-gray-600">
                      {formatDateTime(
                        reservation.return_at, reservation.return_location.timezone
                      )}
                    </p>

                    <span className="mt-2 inline-block rounded-md bg-gray-100 px-2 py-1 text-xs font-medium">
                      {
                        reservation.return_location
                          .airport_code
                      }
                    </span>

                  </div>

                </div>

              </div>
            </section>

          </div>

          {/* Right sidebar */}
          <div className="space-y-6">

            {/* Reservation summary */}
            <section className="rounded-xl bg-surface p-6 shadow-sm">

              <h2 className="text-lg font-semibold">
                Reservation summary
              </h2>

              <div className="mt-5 space-y-4">

                <div>
                  <p className="text-xs text-gray-500">
                    Status
                  </p>

                  <p className="mt-1 font-medium">
                    {reservation.status}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">
                    Booked
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDate(
                      reservation.created_at
                    )}
                  </p>

                  <p className="text-sm text-gray-500">
                    {formatTime(
                      reservation.created_at
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">
                    Pickup
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDate(
                      reservation.pickup_at, reservation.pickup_location.timezone
                    )}
                  </p>

                  <p className="text-sm text-gray-500">
                    {formatTime(
                      reservation.pickup_at, reservation.pickup_location.timezone
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">
                    Return
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDate(
                      reservation.return_at, reservation.return_location.timezone
                    )}
                  </p>

                  <p className="text-sm text-gray-500">
                    {formatTime(
                      reservation.return_at, reservation.return_location.timezone
                    )}
                  </p>
                </div>

                <div className="border-t pt-4">

                  <p className="text-xs text-gray-500">
                    Rental period
                  </p>

                  <p className="mt-1 text-lg font-semibold">
                    {rentalDays}{" "}
                    {rentalDays === 1
                      ? "day"
                      : "days"}
                  </p>

                </div>

              </div>
            </section>

            {/* Locations */}
            <section className="rounded-xl bg-surface p-6 shadow-sm">

              <h2 className="text-lg font-semibold">
                Locations
              </h2>

              <div className="mt-5 space-y-5">

                <div>
                  <p className="text-xs text-gray-500">
                    PICKUP LOCATION
                  </p>

                  <p className="mt-1 font-medium">
                    {
                      reservation.pickup_location
                        .airport_code
                    }
                  </p>

                  <p className="text-sm text-gray-500">
                    {
                      reservation.pickup_location
                        .name
                    }
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">
                    RETURN LOCATION
                  </p>

                  <p className="mt-1 font-medium">
                    {
                      reservation.return_location
                        .airport_code
                    }
                  </p>

                  <p className="text-sm text-gray-500">
                    {
                      reservation.return_location
                        .name
                    }
                  </p>
                </div>

              </div>
            </section>

            {/* Actions */}
            <section className="rounded-xl bg-surface p-6 shadow-sm">

              <h2 className="text-lg font-semibold">
                Actions
              </h2>

              {actionError && (
                <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {actionError}
                </div>
              )}

              {/* PENDING */}
              {reservation.status === "PENDING" && (
                <div className="mt-5 space-y-3">

                  <button
                    onClick={() =>
                      handleStatusChange("CONFIRMED")
                    }
                    disabled={updatingStatus || cancelling}
                    className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingStatus
                      ? "Approving..."
                      : "Approve Reservation"}
                  </button>

                  <button
                    onClick={handleCancelReservation}
                    disabled={updatingStatus || cancelling}
                    className="w-full rounded-lg border-2 border-gray-900 px-4 py-3 font-medium text-gray-900 hover:bg-gray-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancelling
                      ? "Rejecting..."
                      : "Reject Reservation"}
                  </button>

                  <p className="pt-1 text-xs text-gray-500">
                    Approving will let this reservation move on to
                    payment and handover once the customer arrives.
                  </p>

                </div>
              )}

              {/* CONFIRMED */}
              {reservation.status === "CONFIRMED" && (
                <div className="mt-5 space-y-3">

                  <button
                    onClick={() =>
                      navigate(`/handovers/${reservation.id}/check-in`)
                    }
                    className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                  >
                    Start check-in (Payment &amp; Agreement)
                  </button>

                  <button
                    onClick={handleCancelReservation}
                    disabled={updatingStatus || cancelling}
                    className="w-full rounded-lg border-2 border-gray-900 px-4 py-3 font-medium text-gray-900 hover:bg-gray-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancelling
                      ? "Cancelling..."
                      : "Cancel Reservation"}
                  </button>

                  <p className="pt-1 text-xs text-gray-500">
                    Check-in collects payment, signatures, and generates
                    the rental agreement before starting the rental.
                  </p>

                </div>
              )}

              {/* ACTIVE */}
              {reservation.status === "ACTIVE" && (
                <div className="mt-5">

                  <div className="rounded-lg bg-gray-900 p-4">
                    <p className="font-medium text-white">
                      Rental is currently active
                    </p>

                    <p className="mt-1 text-sm text-gray-300">
                      This vehicle is currently with the customer.
                    </p>
                  </div>

                  <button
                    onClick={() =>
                      navigate(`/handovers/${reservation.id}/check-out`)
                    }
                    className="mt-4 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                  >
                    Start check-out
                  </button>

                  {handover?.has_agreement && (
                    <button
                      onClick={() =>
                        downloadAgreement(
                          reservation.id,
                          `agreement-${reservation.id}.pdf`,
                        )
                      }
                      className="mt-3 block w-full rounded-lg border border-gray-300 px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Download Agreement
                    </button>
                  )}

                </div>
              )}

              {/* CANCELLED */}
              {reservation.status === "CANCELLED" && (
                <div className="mt-4 rounded-lg bg-gray-100 p-4">
                  <p className="font-medium text-gray-700">
                    Reservation cancelled
                  </p>

                  <p className="mt-1 text-sm text-gray-500">
                    This reservation is no longer active.
                  </p>

                  {handover?.payment_status === "REFUNDED" && (
                    <p className="mt-2 text-sm text-gray-700">
                      Refunded{" "}
                      {formatCurrency(
                        handover.refund_amount ?? 0,
                        handover.payment_currency ?? undefined,
                      )}{" "}
                      via {handover.payment_method === "CASH" ? "cash" : "card"}.
                    </p>
                  )}
                </div>
              )}

              {/* COMPLETED */}
              {reservation.status === "COMPLETED" && (
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg bg-gray-50 p-4">
                    <p className="font-medium text-gray-800">
                      Rental completed
                    </p>

                    <p className="mt-1 text-sm text-gray-600">
                      This rental has been completed and the
                      reservation is now closed.
                    </p>
                  </div>

                  {handover?.has_agreement && (
                    <button
                      onClick={() =>
                        downloadAgreement(
                          reservation.id,
                          `agreement-${reservation.id}.pdf`,
                        )
                      }
                      className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Download Agreement
                    </button>
                  )}
                </div>
              )}

              {/* Who approved the handover — a quiet line under the
                  actions; expands to show when and their signature. */}
              {handover?.has_agreement && handover.has_employee_signature && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowApproval((open) => !open)}
                    aria-expanded={showApproval}
                    className="flex w-full items-center justify-between gap-2 text-left text-sm text-gray-600 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                  >
                    <span>
                      Approved by{" "}
                      <span className="font-medium text-gray-800">
                        {handover.employee_signed_by_email ?? "a former employee"}
                      </span>
                    </span>

                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition ${
                        showApproval ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {showApproval && (
                    <div className="mt-3 space-y-3">
                      {handover.employee_signed_at && (
                        <p className="text-xs text-gray-500">
                          Signed {formatDateTime(handover.employee_signed_at)}
                        </p>
                      )}

                      {handover.employee_signature_image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={handover.employee_signature_image}
                          alt="Employee signature"
                          className="h-16 w-auto rounded-lg border border-gray-200 bg-white p-2"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* The return: who received the car and what was recorded. */}
              {checkOut?.completed_at && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowCheckOut((open) => !open)}
                    aria-expanded={showCheckOut}
                    className="flex w-full items-center justify-between gap-2 text-left text-sm text-gray-600 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                  >
                    <span>
                      Returned to{" "}
                      <span className="font-medium text-gray-800">
                        {checkOut.employee_signed_by_email ?? "a former employee"}
                      </span>
                    </span>

                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition ${
                        showCheckOut ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {showCheckOut && (
                    <div className="mt-3 space-y-2 text-sm text-gray-700">
                      <p>Returned {formatDateTime(checkOut.returned_at)}</p>
                      <p>
                        {formatNumber(checkOut.return_mileage)} km · fuel{" "}
                        {checkOut.fuel_eighths}/8
                      </p>
                      <p>
                        {checkOut.damage_reported
                          ? `Damage: ${checkOut.damage_notes ?? "reported"}`
                          : "No damage reported"}
                      </p>
                      <p>
                        {checkOut.total_charge > 0
                          ? `Charged ${formatCurrency(
                              checkOut.total_charge,
                              checkOut.payment_currency?.toUpperCase(),
                            )} (${checkOut.payment_method === "CASH" ? "cash" : "card"})`
                          : "No return charges"}
                        {checkOut.waiver_reason &&
                          ` — waived: ${checkOut.waiver_reason}`}
                      </p>

                      {checkOut.employee_signature_image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={checkOut.employee_signature_image}
                          alt="Employee signature at check-out"
                          className="h-16 w-auto rounded-lg border border-gray-200 bg-white p-2"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}


            </section>

          </div>
        </div>

      </div>

      {editing && (
        <ReservationEditModal
          reservation={reservation}
          locations={locations}
          onClose={() => setEditing(false)}
          onSaved={(updated) => setReservation(updated)}
        />
      )}
    </main>
  );
}