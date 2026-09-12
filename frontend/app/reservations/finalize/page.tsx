"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { getReservations, type Reservation } from "@/lib/api";

export default function FinalizeReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function refreshReservations() {
    setRefreshing(true);
    setError("");

    try {
      const data = await getReservations();
      setReservations(data);
    } catch {
      setError("Failed to load reservations.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    async function loadReservations() {
      try {
        const data = await getReservations();
        setReservations(data);
      } catch {
        setError("Failed to load reservations.");
      } finally {
        setLoading(false);
      }
    }

    loadReservations();
  }, []);

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatTime(date: string) {
    return new Date(date).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const awaitingHandover = useMemo(() => {
    return reservations
      .filter((reservation) => reservation.status === "CONFIRMED")
      .sort(
        (a, b) =>
          new Date(a.pickup_at).getTime() - new Date(b.pickup_at).getTime(),
      );
  }, [reservations]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-gray-500">Loading reservations...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-xl bg-white p-8 shadow-sm">
            <p className="text-red-600">{error}</p>

            <button
              onClick={() => refreshReservations()}
              className="mt-4 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Finalize Rentals</h1>

            <p className="mt-2 text-gray-600">
              Confirmed reservations waiting for the customer to arrive —
              take payment, capture a signature, and generate the agreement.
            </p>
          </div>

          <button
            onClick={() => refreshReservations()}
            disabled={refreshing}
            className="flex items-center gap-2 self-start rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Awaiting handover</p>
          <p className="mt-2 text-3xl font-bold">{awaitingHandover.length}</p>
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-sm font-semibold">
                    Customer
                  </th>
                  <th className="px-6 py-4 text-sm font-semibold">Vehicle</th>
                  <th className="px-6 py-4 text-sm font-semibold">Pickup</th>
                  <th className="px-6 py-4 text-sm font-semibold">Route</th>
                  <th className="px-6 py-4 text-sm font-semibold" />
                </tr>
              </thead>

              <tbody>
                {awaitingHandover.map((reservation) => (
                  <tr
                    key={reservation.id}
                    onClick={() =>
                      (window.location.href = `/reservations/finalize/${reservation.id}`)
                    }
                    className="cursor-pointer border-b last:border-b-0 hover:bg-gray-50"
                  >
                    <td className="px-6 py-5">
                      <div className="font-medium">
                        {reservation.customer.first_name}{" "}
                        {reservation.customer.last_name}
                      </div>
                    </td>

                    <td className="px-6 py-5">
                      <div className="font-medium">
                        {reservation.car.make} {reservation.car.model}
                      </div>
                      <div className="mt-1 text-sm text-gray-500">
                        {reservation.car.license_plate}
                      </div>
                    </td>

                    <td className="px-6 py-5">
                      <div className="font-medium">
                        {formatDate(reservation.pickup_at)}
                      </div>
                      <div className="text-sm text-gray-500">
                        {formatTime(reservation.pickup_at)}
                      </div>
                    </td>

                    <td className="px-6 py-5">
                      <span className="text-sm font-medium">
                        {reservation.pickup_location.airport_code}
                      </span>
                      <span className="mx-2 text-gray-400">→</span>
                      <span className="text-sm font-medium">
                        {reservation.return_location.airport_code}
                      </span>
                    </td>

                    <td className="px-6 py-5 text-right">
                      <span className="text-sm font-medium text-gray-600">
                        Start handover →
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {awaitingHandover.length === 0 && (
          <div className="mt-6 rounded-xl bg-white p-10 text-center shadow-sm">
            <p className="font-medium text-gray-700">
              Nothing waiting for handover
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Confirmed reservations will show up here as they&apos;re approved.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
