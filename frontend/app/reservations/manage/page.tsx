"use client";

import { classWords } from "@/lib/classDisplay";
import { useEffect, useState } from "react";
import { CalendarClock, Plus, RefreshCw } from "lucide-react";

import {
  getLocations,
  getPublicConfiguration,
  getReservations,
  getReservationSummary,
  type Location,
  type Reservation,
  type ReservationSummary,
} from "@/lib/api";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { Pagination } from "@/components/ui/Pagination";
import { Toolbar } from "@/components/ui/Toolbar";
import {
  bookingReference,
  formatAge,
  formatDateTime,
  formatDayTime,
  formatDuration,
  hoursSince,
  rentalDays,
} from "@/lib/format";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useNavigate } from "@/lib/useNavigate";
import { useUrlFilters } from "@/lib/useUrlFilters";
import { t } from "@/lib/i18n";

const FILTER_DEFAULTS = {
  q: "",
  status: "ALL",
  location: "ALL",
  source: "ALL",
  window: "ALL",
  sort: "pickup_asc",
  page: "1",
};

const PAGE_SIZE = 25;

export default function ManageReservationsPage() {
  const navigate = useNavigate();
  const { filters, setFilters, clearFilters, isFiltered } =
    useUrlFilters(FILTER_DEFAULTS);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ReservationSummary | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Hours a request may wait for an answer (Configuration > System); 0 turns the flag off.
  const [confirmWithin, setConfirmWithin] = useState(0);
  // "Now" for ages and deadlines, taken when the list was last loaded.
  const [now, setNow] = useState(() => Date.now());
  // Bumped by "Refresh" and "Try again" to re-run the loader effect.
  const [reloadKey, setReloadKey] = useState(0);

  const page = Number(filters.page) || 1;
  // The URL updates on every keystroke; the server is only asked once
  // typing pauses.
  const search = useDebouncedValue(filters.q);

  useEffect(() => {
    getLocations({ includeInactive: true })
      .then(setLocations)
      .catch(() => {});

    getPublicConfiguration()
      .then((configuration) => setConfirmWithin(configuration.confirm_within_hours))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [list, counts] = await Promise.all([
          getReservations({
            q: search,
            status: filters.status === "ALL" ? undefined : filters.status,
            location: filters.location === "ALL" ? undefined : filters.location,
            source: filters.source === "ALL" ? undefined : filters.source,
            window: filters.window === "ALL" ? undefined : filters.window,
            sort: filters.sort,
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
          }),
          getReservationSummary(),
        ]);

        if (cancelled) return;
        setReservations(list.items);
        setNow(Date.now());
        setTotal(list.total);
        setSummary(counts);
      } catch {
        if (!cancelled) setError(t("s.reservations.manage.failedLoadReservations"));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [
    search,
    filters.status,
    filters.location,
    filters.source,
    filters.window,
    filters.sort,
    page,
    reloadKey,
  ]);

  function reload() {
    setRefreshing(true);
    setReloadKey((key) => key + 1);
  }

  // Any filter change goes back to the first page.
  function updateFilters(patch: Partial<typeof filters>) {
    setFilters({ ...patch, page: "1" });
  }

  // The quick-filter tiles reset every other filter, so a tile is either
  // the whole current view or it is not active at all.
  function applyQuickFilter(window: string) {
    updateFilters({ q: "", status: "ALL", location: "ALL", source: "ALL", window });
  }

  const quickFilterActive = (window: string) =>
    filters.window === window &&
    filters.q === "" &&
    filters.status === "ALL" &&
    filters.location === "ALL" &&
    filters.source === "ALL";

  // Requests waiting for an answer, the one that has waited longest first.
  function showAwaitingConfirmation() {
    updateFilters({ q: "", status: "PENDING", location: "ALL", source: "ALL", window: "ALL", sort: "created_asc" });
  }

  const awaitingConfirmationActive =
    filters.status === "PENDING" &&
    filters.window === "ALL" &&
    filters.q === "" &&
    filters.location === "ALL" &&
    filters.source === "ALL";

  // A request waiting for an answer: how close it is to the time the business
  // gives itself (Configuration > System), once that is worth pointing out.
  function confirmNote(reservation: Reservation): { text: string; late: boolean } | null {
    if (reservation.status !== "PENDING" || confirmWithin <= 0) return null;

    const left = confirmWithin - hoursSince(reservation.created_at, now);

    if (left <= 0) {
      return { text: t("s.reservations.manage.confirmOverdue", { hours: Math.max(1, Math.floor(-left)) }), late: true };
    }

    // Flagged for the last quarter of the time, or the last six hours.
    if (left <= Math.max(6, confirmWithin / 4)) {
      return { text: t("s.reservations.manage.confirmWithin", { hours: Math.max(1, Math.ceil(left)) }), late: false };
    }

    return null;
  }

  const rentalLine = (reservation: Reservation) =>
    `${formatDayTime(reservation.pickup_at, reservation.pickup_location.timezone, now)} → ${formatDayTime(
      reservation.return_at,
      reservation.return_location.timezone,
      now,
    )}`;

  const routeLine = (reservation: Reservation) =>
    `${reservation.pickup_location.airport_code} → ${reservation.return_location.airport_code} · ${formatDuration(
      rentalDays(reservation.pickup_at, reservation.return_at, reservation.pickup_location.timezone),
    )}`;

  // One fact per column, a second line only where it helps scanning.
  const columns: Column<Reservation>[] = [
    {
      id: "customer",
      header: t("s.reservations.manage.customer"),
      mobile: "primary",
      cell: (reservation) => (
        <TwoLine
          primary={`${reservation.customer.first_name} ${reservation.customer.last_name}`}
          secondary={
            <>
              <span className="font-mono">{reservation.public_reference ?? bookingReference(reservation.id)}</span>
              {reservation.source === "STOREFRONT" && <> · {t("s.reservations.manage.online")}</>}
            </>
          }
        />
      ),
      mobileCell: (reservation) =>
        `${reservation.customer.first_name} ${reservation.customer.last_name}`,
    },
    {
      id: "vehicle",
      header: t("s.reservations.manage.vehicle"),
      mobile: "secondary",
      cell: (reservation) => (
        <TwoLine
          primary={`${reservation.car.make} ${reservation.car.model}`}
          secondary={
            reservation.vehicle_class
              ? `${classWords(reservation.vehicle_class.name)} · ${reservation.car.license_plate}${reservation.car_confirmed ? "" : ` · ${t("s.reservations.manage.carNotFinalShort")}`}`
              : reservation.car.license_plate
          }
        />
      ),
      mobileCell: (reservation) =>
        `${reservation.car.make} ${reservation.car.model} · ${reservation.car.license_plate}`,
    },
    {
      id: "rental",
      header: t("s.reservations.manage.rental"),
      mobileLabel: "",
      cellClassName: "whitespace-nowrap tabular-nums",
      cell: (reservation) => <TwoLine primary={rentalLine(reservation)} secondary={routeLine(reservation)} />,
      mobileCell: (reservation) => <span className="tabular-nums">{rentalLine(reservation)}</span>,
    },
    {
      id: "booked",
      header: t("s.reservations.manage.booked"),
      mobileLabel: "",
      hideable: true,
      cellClassName: "whitespace-nowrap tabular-nums",
      cell: (reservation) => {
        const note = confirmNote(reservation);

        return (
          <TwoLine
            primary={<span title={formatDateTime(reservation.created_at)}>{formatAge(reservation.created_at, now)}</span>}
            secondary={
              note ? <span className={`font-semibold ${note.late ? "text-danger" : "text-warning"}`}>{note.text}</span> : undefined
            }
          />
        );
      },
      mobileCell: (reservation) => {
        const note = confirmNote(reservation);

        return (
          <span className="font-normal text-ink-muted">
            {routeLine(reservation)} · {t("s.reservations.manage.bookedAge", { age: formatAge(reservation.created_at, now) })}
            {note && <span className={`ml-1.5 font-semibold ${note.late ? "text-danger" : "text-warning"}`}>{note.text}</span>}
          </span>
        );
      },
    },
    {
      id: "status",
      header: t("s.reservations.manage.status"),
      mobile: "trailing",
      cell: (reservation) => (
        <ReservationStatusBadge status={reservation.status} />
      ),
    },
  ];

  if (error) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-border-subtle bg-surface p-8">
          <p className="text-danger" role="alert">
            {error}
          </p>

          <Button className="mt-4" onClick={reload}>{t("s.reservations.manage.tryAgain")}</Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={t("s.reservations.manage.reservations")}
        description={t("s.reservations.manage.manageMonitorVehicleReservations")}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={reload}
              disabled={refreshing}
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {refreshing ? t("s.reservations.manage.refreshing") : t("s.reservations.manage.refresh")}
            </Button>

            <Button onClick={() => navigate("/reservations/new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />{t("s.reservations.manage.newReservation")}</Button>
          </>
        }
      />

      <StatTileGrid columns={5} className="mb-4">
        <StatTile
          label={t("s.reservations.manage.allReservations")}
          value={summary?.total ?? "–"}
          onClick={() => applyQuickFilter("ALL")}
          active={quickFilterActive("ALL")}
        />
        <StatTile
          label={t("s.reservations.manage.awaitingConfirmation")}
          value={summary?.pending ?? "–"}
          onClick={showAwaitingConfirmation}
          active={awaitingConfirmationActive}
        />
        <StatTile
          label={t("s.reservations.manage.todaySActivity")}
          value={summary ? summary.pickup_today + summary.return_today : "–"}
          hint={
            summary
              ? t("s.reservations.manage.outBack", { pickup_today: summary.pickup_today, return_today: summary.return_today })
              : undefined
          }
          onClick={() => applyQuickFilter("TODAY")}
          active={quickFilterActive("TODAY")}
        />
        <StatTile
          label={t("s.reservations.manage.road")}
          value={summary?.active ?? "–"}
          onClick={() => applyQuickFilter("ACTIVE")}
          active={quickFilterActive("ACTIVE")}
        />
        <StatTile
          label={t("s.reservations.manage.upcoming")}
          value={summary?.upcoming ?? "–"}
          onClick={() => applyQuickFilter("UPCOMING")}
          active={quickFilterActive("UPCOMING")}
        />
      </StatTileGrid>

      <Toolbar
        footer={
          <>
            <p>
              {t(isFiltered ? "s.reservations.manage.matchingCount" : "s.reservations.manage.totalCount", { count: total })}
            </p>

            {isFiltered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>{t("s.reservations.manage.clearFilters")}</Button>
            )}
          </>
        }
      >
        <Field label={t("s.reservations.manage.search")}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="search"
              value={filters.q}
              onChange={(event) => updateFilters({ q: event.target.value })}
              placeholder={t("s.reservations.manage.customerPlateVehicle")}
            />
          )}
        </Field>

        <Field label={t("s.reservations.manage.status")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.status}
              onChange={(event) => updateFilters({ status: event.target.value })}
            >
              <option value="ALL">{t("s.reservations.manage.allStatuses")}</option>
              <option value="PENDING">{t("s.reservations.manage.pending")}</option>
              <option value="AWAITING_PAYMENT">{t("s.reservations.manage.awaitingPayment")}</option>
              <option value="CONFIRMED">{t("s.reservations.manage.confirmed")}</option>
              <option value="ACTIVE">{t("s.reservations.manage.active")}</option>
              <option value="COMPLETED">{t("s.reservations.manage.completed")}</option>
              <option value="CANCELLED">{t("s.reservations.manage.cancelled")}</option>
              <option value="EXPIRED">{t("s.reservations.manage.expired")}</option>
            </Select>
          )}
        </Field>

        <Field label={t("s.reservations.manage.bookedVia")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.source}
              onChange={(event) => updateFilters({ source: event.target.value })}
            >
              <option value="ALL">{t("s.reservations.manage.anySource")}</option>
              <option value="STOREFRONT">{t("s.reservations.manage.onlineWebsite")}</option>
              <option value="STAFF">{t("s.reservations.manage.byStaff")}</option>
            </Select>
          )}
        </Field>

        <Field label={t("s.reservations.manage.location")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.location}
              onChange={(event) => updateFilters({ location: event.target.value })}
            >
              <option value="ALL">{t("s.reservations.manage.allLocations")}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.airport_code}>
                  {location.airport_code}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t("s.reservations.manage.period")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.window}
              onChange={(event) => updateFilters({ window: event.target.value })}
            >
              <option value="ALL">{t("s.reservations.manage.anyTime")}</option>
              <option value="TODAY">{t("s.reservations.manage.today")}</option>
              <option value="ACTIVE">{t("s.reservations.manage.road")}</option>
              <option value="UPCOMING">{t("s.reservations.manage.upcoming")}</option>
              <option value="NEXT_7_DAYS">{t("s.reservations.manage.next7Days")}</option>
            </Select>
          )}
        </Field>

        <Field label={t("s.reservations.manage.sortBy")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.sort}
              onChange={(event) => updateFilters({ sort: event.target.value })}
            >
              <option value="pickup_asc">{t("s.reservations.manage.pickupSoonestFirst")}</option>
              <option value="pickup_desc">{t("s.reservations.manage.pickupLatestFirst")}</option>
              <option value="return_asc">{t("s.reservations.manage.returnSoonestFirst")}</option>
              <option value="created_desc">{t("s.reservations.manage.recentlyBooked")}</option>
              <option value="created_asc">{t("s.reservations.manage.bookedOldestFirst")}</option>
            </Select>
          )}
        </Field>
      </Toolbar>

      <DataTable
        rows={reservations}
        columns={columns}
        rowKey={(reservation) => reservation.id}
        tableId="reservations"
        loading={loading}
        onRowClick={(reservation) =>
          navigate(`/reservations/manage/${reservation.id}`)
        }
        empty={{
          icon: CalendarClock,
          title: isFiltered ? t("s.reservations.manage.noReservationsMatch") : t("s.reservations.manage.noReservationsYet"),
          description: isFiltered
            ? t("s.reservations.manage.tryChangingSearchFilters")
            : t("s.reservations.manage.bookingsAppearHereAs"),
          action: isFiltered ? (
            <Button variant="secondary" onClick={clearFilters}>{t("s.reservations.manage.clearFilters")}</Button>
          ) : (
            <Button onClick={() => navigate("/reservations/new")}>{t("s.reservations.manage.newReservation")}</Button>
          ),
        }}
      />

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={(next) => setFilters({ page: String(next) })}
      />
    </PageShell>
  );
}
