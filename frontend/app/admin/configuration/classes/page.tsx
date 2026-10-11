"use client";

import { useCallback, useEffect, useState } from "react";

import { ClassCard } from "@/components/classes/ClassCard";
import { ClassModal } from "@/components/classes/ClassModal";
import { RemoveClassModal } from "@/components/classes/RemoveClassModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  getCars,
  getConfiguration,
  getVehicleClasses,
  reactivateVehicleClass,
  reorderVehicleClasses,
  updateConfiguration,
  type Car,
  type VehicleClass,
} from "@/lib/api";
import { t } from "@/lib/i18n";
import { setUsesVehicleClasses } from "@/lib/vehicleClasses";

export default function ClassesConfigurationPage() {
  const [classes, setClasses] = useState<VehicleClass[] | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [showRetired, setShowRetired] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Adding (new), editing (the class), or neither.
  const [editing, setEditing] = useState<VehicleClass | "new" | null>(null);
  const [removing, setRemoving] = useState<VehicleClass | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // A class just added opens with its cars panel, so cars can go straight in.
  const [openNew, setOpenNew] = useState<string | null>(null);
  // Whether cars are grouped into classes at all; null until known.
  const [usesClasses, setUsesClasses] = useState<boolean | null>(null);
  const [savingSwitch, setSavingSwitch] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rows, fleet] = await Promise.all([getVehicleClasses({ includeRetired: showRetired }), getCars()]);

      setClasses(rows);
      setCars(fleet);
    } catch {
      setError(t("s.admin.configuration.classes.failedLoad"));
    }
  }, [showRetired]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    getConfiguration()
      .then((configuration) => setUsesClasses(configuration.use_vehicle_classes))
      .catch(() => setError(t("s.admin.configuration.classes.failedLoad")));
  }, []);

  async function changeUsesClasses(on: boolean) {
    setSavingSwitch(true);
    setError("");

    try {
      const saved = await updateConfiguration({ use_vehicle_classes: on });

      setUsesClasses(saved.use_vehicle_classes);
      setUsesVehicleClasses(saved.use_vehicle_classes);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.classes.failedSwitch"));
    } finally {
      setSavingSwitch(false);
    }
  }

  // The classes that can be put in order: those in the fleet, in the website's order.
  const orderable = (classes ?? []).filter((row) => !row.is_retired);

  async function moveClass(id: string, toIndex: number) {
    if (!classes) return;

    const from = orderable.findIndex((row) => row.id === id);

    if (from < 0 || toIndex < 0 || toIndex >= orderable.length || from === toIndex) return;

    const next = [...orderable];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved);

    const before = classes;

    // The list moves at once; it goes back if the server says no.
    setClasses([...next, ...classes.filter((row) => row.is_retired)]);
    setError("");

    try {
      await reorderVehicleClasses(next.map((row) => row.id));
    } catch (err) {
      setClasses(before);
      setError(err instanceof Error ? err.message : t("s.admin.configuration.classes.failedOrder"));
    }
  }

  async function reactivate(row: VehicleClass) {
    try {
      await reactivateVehicleClass(row.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.classes.failedSave"));
    }
  }

  const classesCard = (
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
          className="h-4 w-4 accent-accent"
        />
        {t("s.admin.configuration.classes.showRetired")}
      </label>

      {orderable.length > 1 && <p className="mt-3 text-xs text-ink-muted">{t("s.admin.configuration.classes.orderHint")}</p>}

      {notice && (
        <p className="mt-4 text-sm text-ink" role="status">
          {notice}
        </p>
      )}

      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {!classes ? (
        !error && <p className="mt-6 text-ink-secondary">{t("s.admin.configuration.classes.loading")}</p>
      ) : classes.length === 0 ? (
        <p className="mt-6 text-ink-secondary">{t("s.admin.configuration.classes.empty")}</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {classes.map((row) => {
            const position = orderable.findIndex((item) => item.id === row.id);

            return (
              <ClassCard
                key={row.id}
                row={row}
                classes={classes}
                cars={cars}
                position={position}
                total={orderable.length}
                dragging={dragId === row.id}
                startOpen={openNew === row.id}
                onEdit={() => setEditing(row)}
                onRemove={() => setRemoving(row)}
                onToggleRetired={() => void reactivate(row)}
                onMove={(direction) => void moveClass(row.id, position + direction)}
                onDragStart={() => setDragId(row.id)}
                onDragEnd={() => setDragId(null)}
                onDropHere={() => {
                  if (dragId && dragId !== row.id) void moveClass(dragId, position);

                  setDragId(null);
                }}
                onChanged={() => void load()}
              />
            );
          })}
        </ul>
      )}

      {editing && (
        <ClassModal
          existing={editing === "new" ? undefined : editing}
          nextOrder={orderable.length}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            if (editing === "new") setOpenNew(saved.id);

            void load();
          }}
        />
      )}

      {removing && (
        <RemoveClassModal
          row={removing}
          classes={classes ?? []}
          onClose={() => setRemoving(null)}
          onRemoved={(outcome) => {
            setNotice(
              outcome === "deleted"
                ? t("s.admin.configuration.classes.removedDeleted")
                : t("s.admin.configuration.classes.removedRetired"),
            );
            void load();
          }}
        />
      )}
    </Card>
  );

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.classes.useTitle")}</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {usesClasses === false
                ? t("s.admin.configuration.classes.useOff")
                : t("s.admin.configuration.classes.useOn")}
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              role="switch"
              className="h-4 w-4 accent-accent"
              checked={usesClasses !== false}
              disabled={usesClasses === null || savingSwitch}
              onChange={(event) => void changeUsesClasses(event.target.checked)}
            />
            <span className="text-ink-secondary">
              {usesClasses === false
                ? t("s.admin.configuration.classes.switchOff")
                : t("s.admin.configuration.classes.switchOn")}
            </span>
            <span className="sr-only">{t("s.admin.configuration.classes.useTitle")}</span>
          </label>
        </div>

        {error && usesClasses === null && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </Card>

      {usesClasses === false ? (
        <Card>
          <p className="text-sm text-ink-secondary">
            {t("s.admin.configuration.classes.offNote", { count: orderable.length })}
          </p>
        </Card>
      ) : (
        classesCard
      )}
    </>
  );
}
