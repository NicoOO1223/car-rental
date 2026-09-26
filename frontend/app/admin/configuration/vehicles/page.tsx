"use client";

import { useEffect, useState } from "react";

import { getCars, updateCarPrice, type Car } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatCurrency, getDefaultCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";
import { categoryLabel } from "@/lib/carDisplay";

export default function VehicleRatesConfigurationPage() {
  const [cars, setCars] = useState<Car[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getCars()
      .then((data) => {
        if (!cancelled) setCars(data);
      })
      .catch(() => {
        if (!cancelled) setError(t("s.admin.configuration.vehicles.failedLoadVehicles"));
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
                ? { ...item, price_per_day: updated.price_per_day }
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

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.vehicles.vehicleRates")}</h2>

      <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.vehicles.dailyRateEachVehicle")}</p>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {!cars ? (
        !error && <p className="mt-6 text-ink-secondary">{t("s.admin.configuration.vehicles.loadingVehicles")}</p>
      ) : (
        <ul className="mt-6 divide-y divide-border-subtle">
          {cars.map((car) => {
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

                  <p className="text-sm text-ink-muted">{t("s.admin.configuration.vehicles.homeCurrentlyDay", { category: categoryLabel(car.category) ?? t("enums.carCategory.STANDARD"), airport_code: car.home_location.airport_code, price: formatCurrency(car.price_per_day) })}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <label className="sr-only" htmlFor={`rate-${car.id}`}>{t("s.admin.configuration.vehicles.dailyRate", { license_plate: car.license_plate })}</label>

                  <div className="flex items-center gap-1.5">
                    <input
                      id={`rate-${car.id}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft ?? car.price_per_day}
                      onChange={(event) => {
                        setSavedId(null);
                        setDrafts({ ...drafts, [car.id]: event.target.value });
                      }}
                      className="w-28 rounded-lg border border-border-strong bg-white px-3 py-1.5 text-right text-sm text-ink focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />

                    <span className="text-sm text-ink-muted">
                      {getDefaultCurrency()}
                    </span>
                  </div>

                  <Button
                    variant="secondary"
                    onClick={() => save(car)}
                    disabled={!dirty || savingId === car.id}
                  >
                    {savingId === car.id ? t("s.admin.configuration.vehicles.saving") : savedId === car.id ? t("s.admin.configuration.vehicles.saved") : t("s.admin.configuration.vehicles.save")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
