"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Pencil } from "lucide-react";

import {
  getCustomer,
  getCustomerReservations,
  type Customer,
  type CustomerReservation,
} from "@/lib/api";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CustomerEditModal } from "@/components/customers/CustomerEditModal";
import { SkeletonDetailPage } from "@/components/ui/Skeleton";
import { useNavigate } from "@/lib/useNavigate";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default function CustomerDetailsPage({ params }: Props) {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [reservations, setReservations] = useState<CustomerReservation[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const { id } = await params;

        const [customerData, reservationData] = await Promise.all([
          getCustomer(id),
          getCustomerReservations(id),
        ]);

        setCustomer(customerData);
        setReservations(reservationData);
      } catch {
        setError("Failed to load customer.");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [params]);

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString();
  }

  function formatDateTime(date: string) {
    return new Date(date).toLocaleString();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <SkeletonDetailPage />
      </main>
    );
  }

  if (error || !customer) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-red-600">
            {error || "Customer not found."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/customers")}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to customers
          </button>

          <div className="mt-4 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">
                {customer.first_name} {customer.last_name}
              </h1>

              <p className="mt-2 text-gray-500">
                Customer since {formatDate(customer.created_at)}
              </p>
            </div>

            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </div>
        </div>

        {/* Customer information */}
        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Customer Information</h2>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-gray-500">Date of Birth</p>
              <p className="mt-1 font-medium">
                {formatDate(customer.date_of_birth)}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">Postal Code</p>
              <p className="mt-1 font-medium">{customer.postal_code}</p>
            </div>

            <div>
              <p className="text-sm text-gray-500">Phone</p>
              <p className="mt-1 font-medium">
                {customer.phone_number || "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">Email</p>
              <p className="mt-1 font-medium">{customer.email || "—"}</p>
            </div>

            <div className="sm:col-span-2">
              <p className="text-sm text-gray-500">Address</p>
              <p className="mt-1 font-medium">{customer.address}</p>
            </div>

            <div>
              <p className="text-sm text-gray-500">Customer ID</p>
              <p className="mt-1 truncate font-medium">{customer.id}</p>
            </div>
          </div>
        </section>

        {/* Reservation history */}
        <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Reservations</h2>
              <p className="mt-1 text-sm text-gray-500">
                Full booking history
              </p>
            </div>

            <span className="text-sm text-gray-500">
              {reservations.length} booking
              {reservations.length !== 1 ? "s" : ""}
            </span>
          </div>

          {reservations.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium text-gray-700">No reservations</p>
              <p className="mt-1 text-sm text-gray-500">
                This customer has no bookings.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {reservations.map((reservation) => (
                <div
                  key={reservation.id}
                  onClick={() =>
                    navigate(`/reservations/manage/${reservation.id}`)
                  }
                  className="cursor-pointer rounded-lg border p-4 hover:bg-gray-50"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold">
                        {reservation.car.make} {reservation.car.model}
                      </p>

                      <p className="mt-1 text-sm text-gray-500">
                        {reservation.car.license_plate}
                        {" · "}
                        {reservation.pickup_location.airport_code}
                        {" → "}
                        {reservation.return_location.airport_code}
                      </p>
                    </div>

                    <div className="md:text-right">
                      <p className="font-medium">
                        {formatDate(reservation.pickup_at)}
                        {" → "}
                        {formatDate(reservation.return_at)}
                      </p>

                      <p className="mt-1 text-sm text-gray-500">
                        {formatDateTime(reservation.pickup_at)}
                        {" → "}
                        {formatDateTime(reservation.return_at)}
                      </p>
                    </div>

                    <ReservationStatusBadge
                      status={reservation.status}
                      className="self-start md:self-auto"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {editing && (
        <CustomerEditModal
          customer={customer}
          onClose={() => setEditing(false)}
          onSaved={(updated) => setCustomer(updated)}
        />
      )}
    </main>
  );
}
