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
import { bookingReference, formatDate, formatDateTime } from "@/lib/format";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { can } from "@/lib/permissions";
import { useNavigate } from "@/lib/useNavigate";
import { t } from "@/lib/i18n";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default function CustomerDetailsPage({ params }: Props) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const canWrite = can(user?.role, "bookings.write");
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
        setError(t("s.customers.id.failedLoadCustomer"));
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [params]);

  async function handleExport() {
    if (!customer) return;

    setExporting(true);
    setPrivacyActionError("");

    try {
      await downloadCustomerDataExport(customer.id);
    } catch (err) {
      setPrivacyActionError(
        err instanceof Error ? err.message : t("s.customers.id.failedExportCustomerData"),
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleErase() {
    if (!customer) return;

    const confirmed = window.confirm(
      t("s.customers.id.eraseCustomerSPersonal"),
    );

    if (!confirmed) return;

    setErasing(true);
    setPrivacyActionError("");

    try {
      const updated = await eraseCustomer(customer.id);
      setCustomer(updated);
    } catch (err) {
      setPrivacyActionError(
        err instanceof Error ? err.message : t("s.customers.id.failedEraseCustomerData"),
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
          <p className="text-danger">
            {error || t("s.customers.id.customerNotFound")}
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
            className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />{t("s.customers.id.backCustomers")}</button>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold">
                {customer.first_name} {customer.last_name}
              </h1>

              <p className="mt-2 text-ink-muted">{t("s.customers.id.customerSince", { v1: formatDate(customer.created_at) })}</p>
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
                    {exporting ? t("s.customers.id.exporting") : t("s.customers.id.exportData")}
                  </Button>

                  {!customer.anonymized_at && (
                    <Button
                      variant="danger"
                      onClick={handleErase}
                      disabled={erasing}
                    >
                      <Trash2 className="h-4 w-4" />
                      {erasing ? t("s.customers.id.erasing") : t("s.customers.id.eraseCustomerData")}
                    </Button>
                  )}
                </>
              )}

              {!customer.anonymized_at && (
                <Button variant="secondary" onClick={() => setEditing(true)} disabled={!canWrite}>
                  <Pencil className="h-4 w-4" />{t("s.customers.id.edit")}</Button>
              )}
            </div>
          </div>

          {privacyActionError && (
            <p className="mt-3 text-sm text-danger">{privacyActionError}</p>
          )}

          {customer.anonymized_at && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-surface-sunken p-4 text-sm text-ink-secondary">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t("s.customers.id.customerSPersonalData", { v1: formatDate(customer.anonymized_at) })}</span>
            </div>
          )}
        </div>

        {/* Customer information */}
        <section className="rounded-2xl border border-border-subtle bg-surface p-6">
          <h2 className="text-xl font-semibold">{t("s.customers.id.customerInformation")}</h2>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-ink-muted">{t("s.customers.id.dateBirth")}</p>
              <p className="mt-1 font-medium">
                {formatDate(customer.date_of_birth)}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.customers.id.postalCode")}</p>
              <p className="mt-1 font-medium">{customer.postal_code}</p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.customers.id.phone")}</p>
              <p className="mt-1 font-medium">
                {customer.phone_number || "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.customers.id.email")}</p>
              <p className="mt-1 font-medium">{customer.email || "—"}</p>
            </div>

            <div className="sm:col-span-2">
              <p className="text-sm text-ink-muted">{t("s.customers.id.address")}</p>
              <p className="mt-1 font-medium">{customer.address}</p>
            </div>

            <div>
              <p className="text-sm text-ink-muted">{t("s.customers.id.customerReference")}</p>
              <p className="mt-1 font-mono font-medium">
                {bookingReference(customer.id)}
              </p>
            </div>
          </div>
        </section>

        {/* Reservation history */}
        <section className="mt-6 rounded-2xl border border-border-subtle bg-surface p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{t("s.customers.id.reservations")}</h2>
              <p className="mt-1 text-sm text-ink-muted">{t("s.customers.id.fullBookingHistory")}</p>
            </div>

            <span className="text-sm text-ink-muted">{t("common.bookings", { count: reservations.length })}</span>
          </div>

          {reservations.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium text-ink-secondary">{t("s.customers.id.noReservations")}</p>
              <p className="mt-1 text-sm text-ink-muted">{t("s.customers.id.customerHasNoBookings")}</p>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {reservations.map((reservation) => (
                <div
                  key={reservation.id}
                  onClick={() =>
                    navigate(`/reservations/manage/${reservation.id}`)
                  }
                  className="cursor-pointer rounded-lg border p-4 hover:bg-canvas"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold">
                        {reservation.car.make} {reservation.car.model}
                      </p>

                      <p className="mt-1 text-sm text-ink-muted">
                        {reservation.car.license_plate}
                        {" · "}
                        {reservation.pickup_location.airport_code}
                        {" → "}
                        {reservation.return_location.airport_code}
                      </p>
                    </div>

                    <div className="md:text-right">
                      <p className="font-medium">
                        {formatDate(reservation.pickup_at, reservation.pickup_location.timezone)}
                        {" → "}
                        {formatDate(reservation.return_at, reservation.return_location.timezone)}
                      </p>

                      <p className="mt-1 text-sm text-ink-muted">
                        {formatDateTime(reservation.pickup_at, reservation.pickup_location.timezone)}
                        {" → "}
                        {formatDateTime(reservation.return_at, reservation.return_location.timezone)}
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
