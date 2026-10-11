"use client";

import { Car as CarIcon, MapPin } from "lucide-react";

import { carPhotoUrl, type Car } from "@/lib/api";
import { CarImage } from "@/components/cars/CarImage";
import { CarStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { SubNav } from "@/components/ui/SubNav";
import { categoryLabel } from "@/lib/carDisplay";
import { classWords } from "@/lib/classDisplay";
import { formatCurrency } from "@/lib/format";
import { enumLabel, t } from "@/lib/i18n";
import { useUsesVehicleClasses } from "@/lib/vehicleClasses";

const STATUSES = ["AVAILABLE", "RESERVED", "RENTED", "MAINTENANCE", "CLEANING"];

export type FleetVehicleFilters = { layout: string; location: string; status: string };

/** What kind of car it is: its class when it has one (and classes are on), else its category. */
function kindOf(car: Car, classesOn: boolean): string {
  return (classesOn && car.vehicle_class ? classWords(car.vehicle_class.name) : categoryLabel(car.category)) ?? "";
}

/**
 * Every vehicle at a glance, as cards or as a table. The schedule view answers
 * "when is this car free"; this one answers "what do we have, and where is it".
 *
 * The page owns the search box and the list of cars; this filters further by
 * place and status, and remembers the choices in the address.
 */
export function FleetVehicles({
  cars,
  statusOf,
  filters,
  onFiltersChange,
  onOpen,
  searching,
}: {
  /** Already narrowed by the page's search box. */
  cars: Car[];
  /** A car's status on the day the page is looking at. */
  statusOf: (car: Car) => string;
  filters: FleetVehicleFilters;
  onFiltersChange: (patch: Partial<FleetVehicleFilters>) => void;
  onOpen: (car: Car) => void;
  /** Whether the page's search box has text in it, for the empty message. */
  searching: boolean;
}) {
  const classesOn = useUsesVehicleClasses();
  const kind = (car: Car) => kindOf(car, classesOn);

  const locations = [...new Map(cars.map((car) => [car.home_location.airport_code, car.home_location])).values()].sort((a, b) =>
    a.airport_code.localeCompare(b.airport_code),
  );

  const shown = cars.filter(
    (car) =>
      (filters.location === "ALL" || car.home_location.airport_code === filters.location) &&
      (filters.status === "ALL" || statusOf(car) === filters.status),
  );

  const filtered = filters.location !== "ALL" || filters.status !== "ALL";

  const placeOf = (car: Car) =>
    car.is_away_from_home
      ? t("s.cars.awayHome", { airport_code: car.current_location.airport_code })
      : car.home_location.name;

  const columns: Column<Car>[] = [
    {
      id: "vehicle",
      header: t("s.cars.vehicle"),
      mobile: "primary",
      cell: (car) => <TwoLine primary={`${car.make} ${car.model}`} secondary={<span className="font-mono">{car.license_plate}</span>} />,
      mobileCell: (car) => `${car.make} ${car.model}`,
      sortable: true,
      sortAccessor: (car) => `${car.make} ${car.model} ${car.license_plate}`,
    },
    {
      id: "plate",
      header: t("s.cars.plate"),
      mobile: "secondary",
      mobileOnly: true,
      cell: (car) => car.license_plate,
    },
    {
      id: "kind",
      header: t("s.cars.kind"),
      mobileLabel: "",
      cell: (car) => kind(car) || "—",
      sortable: true,
      sortAccessor: kind,
    },
    {
      id: "status",
      header: t("s.cars.status"),
      mobile: "trailing",
      cell: (car) => <CarStatusBadge status={statusOf(car)} />,
      sortable: true,
      sortAccessor: (car) => enumLabel("carStatus", statusOf(car)),
    },
    {
      id: "location",
      header: t("s.cars.location"),
      mobileLabel: "",
      cell: (car) => (
        <TwoLine
          primary={car.home_location.airport_code}
          secondary={
            car.is_away_from_home ? <span className="font-semibold text-warning">{placeOf(car)}</span> : car.home_location.name
          }
        />
      ),
      mobileCell: (car) => (car.is_away_from_home ? <span className="text-warning">{placeOf(car)}</span> : car.home_location.name),
      sortable: true,
      sortAccessor: (car) => car.home_location.airport_code,
    },
    {
      id: "mileage",
      header: t("s.cars.mileage"),
      mobile: "hidden",
      hideable: true,
      align: "right",
      cellClassName: "tabular-nums",
      cell: (car) => (car.mileage != null ? t("common.km", { value: car.mileage }) : "—"),
      sortable: true,
      sortAccessor: (car) => car.mileage,
      defaultSortDirection: "desc",
    },
    {
      id: "price",
      header: t("s.cars.pricePerDay"),
      mobile: "hidden",
      hideable: true,
      align: "right",
      cellClassName: "tabular-nums",
      cell: (car) => formatCurrency(car.price_per_day),
      sortable: true,
      sortAccessor: (car) => Number(car.price_per_day),
    },
  ];

  const empty = {
    icon: CarIcon,
    title: t("s.cars.noVehiclesFound"),
    description: searching || filtered ? t("s.cars.noVehiclesMatchFilters") : t("s.cars.thereCurrentlyNoVehicles"),
    action: filtered ? (
      <Button variant="secondary" onClick={() => onFiltersChange({ location: "ALL", status: "ALL" })}>
        {t("s.cars.clearFilters")}
      </Button>
    ) : undefined,
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          aria-label={t("s.cars.location")}
          className="w-full sm:w-52"
          value={filters.location}
          onChange={(event) => onFiltersChange({ location: event.target.value })}
        >
          <option value="ALL">{t("s.cars.allLocations")}</option>
          {locations.map((location) => (
            <option key={location.airport_code} value={location.airport_code}>
              {location.airport_code} · {location.name}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t("s.cars.status")}
          className="w-full sm:w-44"
          value={filters.status}
          onChange={(event) => onFiltersChange({ status: event.target.value })}
        >
          <option value="ALL">{t("s.cars.allStatuses")}</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {enumLabel("carStatus", status)}
            </option>
          ))}
        </Select>

        <p className="text-sm text-ink-muted">{t("common.vehicles", { count: shown.length })}</p>

        <SubNav
          className="ml-auto"
          label={t("s.cars.layout")}
          activeId={filters.layout === "table" ? "table" : "grid"}
          onSelect={(layout) => onFiltersChange({ layout })}
          items={[
            { id: "grid", label: t("s.cars.layoutGrid") },
            { id: "table", label: t("s.cars.layoutTable") },
          ]}
        />
      </div>

      {filters.layout === "table" ? (
        <DataTable tableId="fleet" rows={shown} columns={columns} rowKey={(car) => car.id} onRowClick={onOpen} empty={empty} />
      ) : shown.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((car) => (
            <li key={car.id}>
              <button
                type="button"
                onClick={() => onOpen(car)}
                className="group block w-full overflow-hidden rounded-2xl border border-border-subtle bg-surface text-left transition hover:border-accent-line hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2"
              >
                <div className="relative">
                  <CarImage
                    imageUrl={car.has_photo ? carPhotoUrl(car.id, car.photo_version) : null}
                    category={car.category}
                    alt=""
                    className="aspect-[16/10] w-full"
                  />
                  <CarStatusBadge status={statusOf(car)} className="absolute left-3 top-3 shadow-sm" />
                </div>

                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold text-ink">
                      {car.make} {car.model}
                    </p>
                    <span className="shrink-0 rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-xs text-ink-secondary">
                      {car.license_plate}
                    </span>
                  </div>

                  <p className="mt-0.5 truncate text-sm text-ink-muted">{kind(car) || "—"}</p>

                  <p className={`mt-3 flex items-center gap-1.5 text-sm ${car.is_away_from_home ? "font-semibold text-warning" : "text-ink-secondary"}`}>
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{car.is_away_from_home ? placeOf(car) : `${car.home_location.airport_code} · ${car.home_location.name}`}</span>
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
