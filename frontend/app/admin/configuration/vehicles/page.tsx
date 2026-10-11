"use client";

import { useEffect, useState } from "react";

import {
  getCars,
  getLocations,
  getVehicleClasses,
  reactivateCar,
  retireCar,
  setCarClass,
  updateCarPrice,
  type Car,
  type Location,
  type VehicleClass,
} from "@/lib/api";
import { AddVehicleModal } from "@/components/cars/AddVehicleModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency, getDefaultCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useUsesVehicleClasses } from "@/lib/vehicleClasses";
import { categoryLabel } from "@/lib/carDisplay";
import { classWords } from "@/lib/classDisplay";

export default function VehicleRatesConfigurationPage() {
  const classesOn = useUsesVehicleClasses();
  const [cars, setCars] = useState<Car[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);

  const [showRetired, setShowRetired] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [adding, setAdding] = useState(false);
  const [classes, setClasses] = useState<VehicleClass[]>([]);
  // The car staff are about to retire, until they confirm or back out.
  const [retiring, setRetiring] = useState<Car | null>(null);
  const [retireError, setRetireError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getCars({ includeRetired: showRetired })
      .then((data) => {
        if (!cancelled) setCars(data);
      })
      .catch(() => {
        if (!cancelled) setError(t("s.admin.configuration.vehicles.failedLoadVehicles"));
      });

    return () => {
      cancelled = true;
    };
  }, [showRetired]);

  // A car can only join at a place that is in use.
  useEffect(() => {
    getLocations().then(setLocations).catch(() => undefined);
  }, []);

  useEffect(() => {
    getVehicleClasses().then(setClasses).catch(() => undefined);
  }, []);

  async function changeClass(car: Car, classId: string) {
    setBusyId(car.id);
    setError("");

    try {
      replaceCar(await setCarClass(car.id, classId || null));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.vehicles.failedUpdateRate"));
    } finally {
      setBusyId(null);
    }
  }

  function replaceCar(updated: Car) {
    setCars((current) =>
      current ? current.map((item) => (item.id === updated.id ? updated : item)) : current,
    );
  }

  async function confirmRetire() {
    if (!retiring) return;

    setBusyId(retiring.id);
    setRetireError("");

    try {
      const updated = await retireCar(retiring.id);

      // Gone from the list unless retired cars are being shown.
      setCars((current) =>
        current
          ? showRetired
            ? current.map((item) => (item.id === updated.id ? updated : item))
            : current.filter((item) => item.id !== updated.id)
          : current,
      );
      setRetiring(null);
    } catch (err) {
      setRetireError(err instanceof Error ? err.message : t("s.admin.configuration.vehicles.failedRetire"));
    } finally {
      setBusyId(null);
    }
  }

  async function reactivate(car: Car) {
    setBusyId(car.id);
    setError("");

    try {
      replaceCar(await reactivateCar(car.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.vehicles.failedReactivate"));
    } finally {
      setBusyId(null);
    }
  }

  async function save(car: Car) {
    const draft = drafts[car.id];

    if (draft === undefined) return;

    setSavingId(car.id);
    setSavedId(null);
    setError("");

    try {
      const updated = await updateCarPrice(car.id, draft);

      setCars((current) =>
        current
          ? current.map((item) =>
              item.id === car.id
                ? {
                    ...item,
                    price_per_day: updated.price_per_day,
                    class_id: updated.class_id,
                    vehicle_class: updated.vehicle_class,
                  }
                : item,
            )
          : current,
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[car.id];

        return next;
      });
      setSavedId(car.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.vehicles.failedUpdateRate"));
    } finally {
      setSavingId(null);
    }
  }

  function renderRows(list: Car[]) {
    return list.map((car) => {
              const draft = drafts[car.id];
              const dirty = draft !== undefined && draft !== car.price_per_day;

              return (
                <li
                  key={car.id}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {car.make} {car.model}
                      <span className="ml-2 text-sm font-normal text-ink-muted">
                        {car.license_plate}
                      </span>
                    </p>

                    {car.is_retired && (
                      <p className="text-sm font-medium text-warning">{t("s.admin.configuration.vehicles.retired")}</p>
                    )}

                    <p className="text-sm text-ink-muted">{t("s.admin.configuration.vehicles.homeCurrentlyDay", { category: categoryLabel(car.category) ?? t("enums.carCategory.STANDARD"), airport_code: car.home_location.airport_code, price: formatCurrency(car.price_per_day) })}</p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {classesOn && (
                      <>
                        <label className="sr-only" htmlFor={`class-${car.id}`}>
                          {t("s.admin.configuration.vehicles.classOf", { license_plate: car.license_plate })}
                        </label>
                        <select
                          id={`class-${car.id}`}
                          value={car.class_id ?? ""}
                          disabled={car.is_retired || busyId === car.id}
                          onChange={(event) => void changeClass(car, event.target.value)}
                          className="max-w-40 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent-ink focus:outline-none focus:ring-2 focus:ring-accent-ink"
                        >
                          <option value="">{t("s.admin.configuration.vehicles.noClass")}</option>
                          {classes.map((option) => (
                            <option key={option.id} value={option.id}>
                              {classWords(option.name)}
                            </option>
                          ))}
                        </select>
                      </>
                    )}

                    <label className="sr-only" htmlFor={`rate-${car.id}`}>{t("s.admin.configuration.vehicles.dailyRate", { license_plate: car.license_plate })}</label>

                    <div className="flex items-center gap-1.5">
                      <input
                        id={`rate-${car.id}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft ?? car.price_per_day}
                        disabled={car.is_retired || (classesOn && car.class_id !== null)}
                        title={classesOn && car.class_id ? t("s.admin.configuration.vehicles.pricedByClass") : undefined}
                        onChange={(event) => {
                          setSavedId(null);
                          setDrafts({ ...drafts, [car.id]: event.target.value });
                        }}
                        className="w-28 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-right text-sm text-ink focus:border-accent-ink focus:outline-none focus:ring-2 focus:ring-accent-ink"
                      />

                      <span className="text-sm text-ink-muted">
                        {getDefaultCurrency()}
                      </span>
                    </div>

                    <Button
                      variant="secondary"
                      onClick={() => save(car)}
                      disabled={!dirty || savingId === car.id || (classesOn && car.class_id !== null)}
                    >
                      {savingId === car.id ? t("s.admin.configuration.vehicles.saving") : savedId === car.id ? t("s.admin.configuration.vehicles.saved") : t("s.admin.configuration.vehicles.save")}
                    </Button>

                    {car.is_retired ? (
                      <Button variant="ghost" onClick={() => reactivate(car)} loading={busyId === car.id}>
                        {t("s.admin.configuration.vehicles.reactivate")}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setRetireError("");
                          setRetiring(car);
                        }}
                      >
                        {t("s.admin.configuration.vehicles.retire")}
                      </Button>
                    )}
                  </div>
                </li>
              );
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.vehicles.vehicleRates")}</h2>

          <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.vehicles.dailyRateEachVehicle")}</p>
        </div>

        <Button onClick={() => setAdding(true)} disabled={locations.length === 0}>
          {t("s.admin.configuration.vehicles.addVehicle")}
        </Button>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          checked={showRetired}
          onChange={(event) => setShowRetired(event.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        {t("s.admin.configuration.vehicles.showRetired")}
      </label>

      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {!cars ? (
        !error && <p className="mt-6 text-ink-secondary">{t("s.admin.configuration.vehicles.loadingVehicles")}</p>
      ) : (
        <>
          {!classesOn && cars.some((car) => car.class_id) && (
            <p className="mt-6 text-sm text-ink-secondary">{t("s.admin.configuration.vehicles.leavesClass")}</p>
          )}

          <ul className="mt-6 divide-y divide-border-subtle">
            {renderRows(classesOn ? cars.filter((car) => !car.class_id) : cars)}
          </ul>

          {classesOn && cars.some((car) => car.class_id) && (
            <details className="mt-8 rounded-lg border border-border-subtle p-4">
              <summary className="cursor-pointer text-sm font-medium text-ink">
                {t("s.admin.configuration.vehicles.inClasses", { count: cars.filter((car) => car.class_id).length })}
              </summary>
              <p className="mt-2 text-sm text-ink-secondary">{t("s.admin.configuration.vehicles.inClassesHint")}</p>
              <ul className="mt-3 divide-y divide-border-subtle">{renderRows(cars.filter((car) => car.class_id))}</ul>
            </details>
          )}
        </>
      )}

      {adding && (
        <AddVehicleModal
          locations={locations}
          onClose={() => setAdding(false)}
          onCreated={(car) =>
            setCars((current) =>
              current ? [...current, car].sort((a, b) => a.license_plate.localeCompare(b.license_plate)) : current,
            )
          }
        />
      )}

      {retiring && (
        <Modal
          isOpen
          title={t("s.admin.configuration.vehicles.retireTitle", { license_plate: retiring.license_plate })}
          onClose={() => setRetiring(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRetiring(null)}>
                {t("s.admin.configuration.vehicles.keepInFleet")}
              </Button>
              <Button onClick={confirmRetire} loading={busyId === retiring.id}>
                {t("s.admin.configuration.vehicles.confirmRetire")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-secondary">{t("s.admin.configuration.vehicles.retireExplanation")}</p>

          {retireError && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {retireError}
            </p>
          )}
        </Modal>
      )}
    </Card>
  );
}
