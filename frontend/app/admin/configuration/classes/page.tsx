"use client";

import { useEffect, useState } from "react";

import { ClassModal } from "@/components/classes/ClassModal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  getVehicleClasses,
  reactivateVehicleClass,
  retireVehicleClass,
  type VehicleClass,
} from "@/lib/api";
import { classWords } from "@/lib/classDisplay";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";

export default function ClassesConfigurationPage() {
  const [classes, setClasses] = useState<VehicleClass[] | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Adding (true), editing (the class), or neither.
  const [editing, setEditing] = useState<VehicleClass | "new" | null>(null);

  useEffect(() => {
    let cancelled = false;

    getVehicleClasses({ includeRetired: showRetired })
      .then((data) => {
        if (!cancelled) setClasses(data);
      })
      .catch(() => {
        if (!cancelled) setError(t("s.admin.configuration.classes.failedLoad"));
      });

    return () => {
      cancelled = true;
    };
  }, [showRetired]);

  function applySaved(saved: VehicleClass) {
    setClasses((current) => {
      if (!current) return current;

      const exists = current.some((item) => item.id === saved.id);
      const next = exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];

      return next.sort((a, b) => a.sort_order - b.sort_order || classWords(a.name).localeCompare(classWords(b.name)));
    });
  }

  async function toggleRetired(row: VehicleClass) {
    setBusyId(row.id);
    setError("");

    try {
      const updated = row.is_retired ? await reactivateVehicleClass(row.id) : await retireVehicleClass(row.id);

      setClasses((current) =>
        current
          ? showRetired || updated.is_retired === false
            ? current.map((item) => (item.id === updated.id ? updated : item))
            : current.filter((item) => item.id !== updated.id)
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.classes.failedSave"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.classes.title")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.classes.intro")}</p>
        </div>

        <Button onClick={() => setEditing("new")}>{t("s.admin.configuration.classes.add")}</Button>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          checked={showRetired}
          onChange={(event) => setShowRetired(event.target.checked)}
          className="h-4 w-4 accent-gray-900"
        />
        {t("s.admin.configuration.classes.showRetired")}
      </label>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {!classes ? (
        !error && <p className="mt-6 text-ink-secondary">{t("s.admin.configuration.classes.loading")}</p>
      ) : classes.length === 0 ? (
        <p className="mt-6 text-ink-secondary">{t("s.admin.configuration.classes.empty")}</p>
      ) : (
        <ul className="mt-6 divide-y divide-border-subtle">
          {classes.map((row) => (
            <li key={row.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {classWords(row.name)}
                  <span className="ml-2 text-sm font-normal text-ink-muted">{row.slug}</span>
                </p>

                {classWords(row.description) && (
                  <p className="mt-0.5 text-sm text-ink-secondary">{classWords(row.description)}</p>
                )}

                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                  <span>{t("s.admin.configuration.classes.perDay", { price: formatCurrency(row.price_per_day) })}</span>
                  <span>·</span>
                  <span>
                    {t("s.admin.configuration.classes.cars", { count: row.car_count, online: row.online_car_count })}
                  </span>
                  {!row.offered_online && (
                    <Badge colorClass="bg-surface-sunken text-ink-secondary">
                      {t("s.admin.configuration.classes.notOnline")}
                    </Badge>
                  )}
                  {row.is_retired && (
                    <Badge colorClass="bg-amber-100 text-amber-800">{t("s.admin.configuration.classes.retired")}</Badge>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" onClick={() => setEditing(row)}>
                  {t("s.admin.configuration.classes.edit")}
                </Button>

                <Button variant="ghost" onClick={() => toggleRetired(row)} loading={busyId === row.id}>
                  {row.is_retired ? t("s.admin.configuration.classes.reactivate") : t("s.admin.configuration.classes.retire")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ClassModal
          existing={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={applySaved}
        />
      )}
    </Card>
  );
}
