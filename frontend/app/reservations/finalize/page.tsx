"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSignature, RefreshCw } from "lucide-react";

import { getReservations, type Reservation } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { formatDate, formatTime } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";

export default function FinalizeReservationsPage() {
  const navigate = useNavigate();

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function refreshReservations() {
    setRefreshing(true);
    setError("");

    try {
      setReservations(await getReservations());
    } catch {
      setError("Failed to load reservations.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    async function loadReservations() {
      try {
        setReservations(await getReservations());
      } catch {
        setError("Failed to load reservations.");
      } finally {
        setLoading(false);
      }
    }

    loadReservations();
  }, []);

  const awaitingHandover = useMemo(
    () =>
      reservations
        .filter((reservation) => reservation.status === "CONFIRMED")
        .sort(
          (a, b) =>
            new Date(a.pickup_at).getTime() - new Date(b.pickup_at).getTime(),
        ),
    [reservations],
  );

  const columns: Column<Reservation>[] = [
    {
      id: "customer",
      header: "Customer",
      mobile: "primary",
      cell: (reservation) =>
        `${reservation.customer.first_name} ${reservation.customer.last_name}`,
      sortable: true,
      sortAccessor: (reservation) =>
        `${reservation.customer.last_name} ${reservation.customer.first_name}`,
    },
    {
      id: "vehicle",
      header: "Vehicle",
      mobile: "secondary",
      cell: (reservation) => (
        <TwoLine
          primary={`${reservation.car.make} ${reservation.car.model}`}
          secondary={reservation.car.license_plate}
        />
      ),
      mobileCell: (reservation) =>
        `${reservation.car.make} ${reservation.car.model} · ${reservation.car.license_plate}`,
      sortable: true,
      sortAccessor: (reservation) =>
        `${reservation.car.make} ${reservation.car.model}`,
    },
    {
      id: "pickup",
      header: "Pickup",
      mobileLabel: "Pickup",
      cell: (reservation) => (
        <TwoLine
          primary={formatDate(reservation.pickup_at)}
          secondary={formatTime(reservation.pickup_at)}
        />
      ),
      mobileCell: (reservation) =>
        `${formatDate(reservation.pickup_at)}, ${formatTime(reservation.pickup_at)}`,
      sortable: true,
      sortAccessor: (reservation) => new Date(reservation.pickup_at),
    },
    {
      id: "route",
      header: "Route",
      mobileLabel: "Route",
      cell: (reservation) => (
        <span className="text-sm font-medium text-ink">
          {reservation.pickup_location.airport_code}
          <span className="mx-2 text-ink-muted" aria-hidden="true">
            →
          </span>
          {reservation.return_location.airport_code}
        </span>
      ),
    },
  ];

  if (error) {
    return (
      <PageShell width="medium">
        <div className="rounded-xl bg-surface p-8 shadow-sm">
          <p className="text-red-600" role="alert">
            {error}
          </p>

          <Button className="mt-4" onClick={refreshReservations}>
            Try again
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell width="medium">
      <PageHeader
        title="Finalize rentals"
        description="Confirmed reservations waiting for the customer to arrive. Take payment, capture a signature, and generate the agreement."
        actions={
          <Button
            variant="secondary"
            onClick={refreshReservations}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      <StatTileGrid columns={2} className="mb-6">
        <StatTile
          label="Awaiting handover"
          value={awaitingHandover.length}
          icon={FileSignature}
        />
      </StatTileGrid>

      <DataTable
        rows={awaitingHandover}
        columns={columns}
        rowKey={(reservation) => reservation.id}
        loading={loading}
        onRowClick={(reservation) =>
          navigate(`/reservations/finalize/${reservation.id}`)
        }
        rowActions={[
          {
            label: "Start handover",
            onClick: (reservation) =>
              navigate(`/reservations/finalize/${reservation.id}`),
          },
        ]}
        empty={{
          icon: FileSignature,
          title: "Nothing waiting for handover",
          description:
            "Confirmed reservations show up here once they are approved.",
        }}
      />
    </PageShell>
  );
}
