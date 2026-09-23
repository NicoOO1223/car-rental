"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Download, Pencil, ShieldAlert, Trash2 } from "lucide-react";

import {
  downloadCustomerDataExport,
  eraseCustomer,
  getCustomer,
  getCustomerReservations,
  type Customer,
  type CustomerReservation,
} from "@/lib/api";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CustomerEditModal } from "@/components/customers/CustomerEditModal";
import { SkeletonDetailPage } from "@/components/ui/Skeleton";
import { bookingReference } from "@/lib/format";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useNavigate } from "@/lib/useNavigate";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default function CustomerDetailsPage({ params }: Props) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [reservations, setReservations] = useState<CustomerReservation[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [privacyActionError, setPrivacyActionError] = useState("");

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

  async function handleExport() {
    if (!customer) return;

    setExporting(true);
    setPrivacyActionError("");

    try {
      await downloadCustomerDataExport(customer.id);
    } catch (err) {
      setPrivacyActionError(
        err instanceof Error ? err.message : "Failed to export customer data.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleErase() {
    if (!customer) return;

    const confirmed = window.confirm(
      "Erase this customer's personal data? This cannot be undone — their name, date of birth, address, and contact details will be permanently replaced with placeholders. Their reservation history stays on file.",
    );

    if (!confirmed) return;

    setErasing(true);
    setPrivacyActionError("");

    try {
      const updated = await eraseCustomer(customer.id);
      setCustomer(updated);
    } catch (err) {
      setPrivacyActionError(
        err instanceof Error ? err.message : "Failed to erase customer data.",
      );
    } finally {
      setErasing(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <SkeletonDetailPage />
      </main>
    );
  }

  if (error || !customer) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-red-600">
            {error || "Customer not found."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
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

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold">
                {customer.first_name} {customer.last_name}
              </h1>

              <p className="mt-2 text-gray-500">
                Customer since {formatDate(customer.created_at)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {user?.role === "admin" && (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleExport}
                    disabled={exporting}
                  >
                    <Download className="h-4 w-4" />
                    {exporting ? "Exporting..." : "Export Data"}
                  </Button>

                  {!customer.anonymized_at && (
                    <Button
                      variant="danger"
                      onClick={handleErase}
                      disabled={erasing}
                    >
                      <Trash2 className="h-4 w-4" />
                      {erasing ? "Erasing..." : "Erase Customer Data"}
                    </Button>
                  )}
                </>
              )}

              {!customer.anonymized_at && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              )}
            </div>
          </div>

          {privacyActionError && (
            <p className="mt-3 text-sm text-red-600">{privacyActionError}</p>
          )}

          {customer.anonymized_at && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-gray-100 p-4 text-sm text-gray-700">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                This customer&apos;s personal data was erased on{" "}
                {formatDate(customer.anonymized_at)}. Their reservation history
                is kept for accounting/legal record-keeping, but the fields
                below are placeholders and can no longer be edited.
              </span>
            </div>
          )}
        </div>

        {/* Customer information */}
        <section className="rounded-xl bg-surface p-6 shadow-sm">
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
              <p className="text-sm text-gray-500">Customer reference</p>
              <p className="mt-1 font-mono font-medium">
                {bookingReference(customer.id)}
              </p>
            </div>
          </div>
        </section>

        {/* Reservation history */}
        <section className="mt-6 rounded-xl bg-surface p-6 shadow-sm">
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
