"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, ImagePlus, Trash2 } from "lucide-react";

import { CarImage } from "@/components/cars/CarImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  addCarsToClass,
  classPhotoUrl,
  deleteClassPhoto,
  setCarClass,
  uploadClassPhoto,
  type Car,
  type VehicleClass,
} from "@/lib/api";
import { classWords } from "@/lib/classDisplay";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type Props = {
  row: VehicleClass;
  classes: VehicleClass[];
  /** Every car in the fleet, to list this class's and to pick more from. */
  cars: Car[];
  /** Position among the classes that can be ordered (retired ones cannot); -1 when it cannot. */
  position: number;
  total: number;
  dragging: boolean;
  startOpen?: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onToggleRetired: () => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropHere: () => void;
  /** The class changed (photo, cars): the page reloads what depends on it. */
  onChanged: (updated?: VehicleClass) => void;
};

/** One class: how it looks on the website, its price, its cars, and what can be done with it. */
export function ClassCard({
  row,
  classes,
  cars,
  position,
  total,
  dragging,
  startOpen = false,
  onEdit,
  onRemove,
  onToggleRetired,
  onMove,
  onDragStart,
  onDragEnd,
  onDropHere,
  onChanged,
}: Props) {
  const orderable = position >= 0;
  const [open, setOpen] = useState(startOpen);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const members = cars.filter((car) => car.class_id === row.id);
  const others = cars
    .filter((car) => car.class_id !== row.id)
    // Cars without a class first: they are the ones usually being added.
    .sort((a, b) => Number(a.class_id !== null) - Number(b.class_id !== null) || a.license_plate.localeCompare(b.license_plate));
  const classNameOf = (id: string | null) => classWords(classes.find((item) => item.id === id)?.name);

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setError("");

    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  async function handlePhotoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setError(t("c.classes.ClassCard.photoType"));
      return;
    }

    if (file.size > MAX_PHOTO_BYTES) {
      setError(t("c.classes.ClassCard.photoTooLarge", { mb: MAX_PHOTO_BYTES / (1024 * 1024) }));
      return;
    }

    await run(async () => onChanged(await uploadClassPhoto(row.id, await readAsDataUrl(file))), t("c.classes.ClassCard.failedPhoto"));
  }

  const addPicked = () =>
    run(async () => {
      onChanged(await addCarsToClass(row.id, [...picked]));
      setPicked(new Set());
    }, t("c.classes.ClassCard.failedCars"));

  const takeOut = (car: Car) =>
    run(async () => {
      await setCarClass(car.id, null);
      onChanged();
    }, t("c.classes.ClassCard.failedCars"));

  return (
    <li
      className={`rounded-xl border border-border-subtle bg-surface p-4 ${dragging ? "opacity-50" : ""}`}
      onDragOver={(event) => orderable && event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (orderable) onDropHere();
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {orderable && (
          <span
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            className="hidden cursor-grab select-none self-center text-ink-muted active:cursor-grabbing sm:block"
            title={t("c.classes.ClassCard.dragHandle", { name: classWords(row.name) })}
            aria-hidden="true"
          >
            <GripVertical className="h-5 w-5" />
          </span>
        )}

        <CarImage
          imageUrl={row.has_photo ? classPhotoUrl(row.slug, row.photo_version) : null}
          category={null}
          alt={classWords(row.name)}
          className="aspect-[16/9] w-full shrink-0 rounded-lg sm:w-40"
        />

        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">
            {classWords(row.name)}
            <span className="ml-2 text-sm font-normal text-ink-muted">{row.slug}</span>
          </p>

          {classWords(row.description) && <p className="mt-0.5 text-sm text-ink-secondary">{classWords(row.description)}</p>}

          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>{t("s.admin.configuration.classes.perDay", { price: formatCurrency(row.price_per_day) })}</span>
            <span>·</span>
            <span>{t("s.admin.configuration.classes.cars", { count: row.car_count, online: row.online_car_count })}</span>
            {!row.offered_online && (
              <Badge colorClass="bg-surface-sunken text-ink-secondary">{t("s.admin.configuration.classes.notOnline")}</Badge>
            )}
            {row.is_retired && <Badge colorClass="bg-warning-soft text-warning">{t("s.admin.configuration.classes.retired")}</Badge>}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={onEdit}>
              {t("s.admin.configuration.classes.edit")}
            </Button>

            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={handlePhotoFile}
              aria-label={t("c.classes.ClassCard.choosePhoto", { name: classWords(row.name) })}
            />
            <Button variant="secondary" loading={busy} onClick={() => fileInput.current?.click()}>
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              {row.has_photo ? t("c.classes.ClassCard.replacePhoto") : t("c.classes.ClassCard.uploadPhoto")}
            </Button>
            {row.has_photo && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => run(async () => onChanged(await deleteClassPhoto(row.id)), t("c.classes.ClassCard.failedPhoto"))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("c.classes.ClassCard.removePhoto")}
              </Button>
            )}

            <Button variant="ghost" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
              {open ? t("c.classes.ClassCard.hideCars") : t("c.classes.ClassCard.showCars", { count: members.length })}
            </Button>

            {row.is_retired ? (
              <Button variant="ghost" onClick={onToggleRetired}>
                {t("s.admin.configuration.classes.reactivate")}
              </Button>
            ) : null}

            <Button variant="ghost" onClick={onRemove}>
              {t("c.classes.ClassCard.remove")}
            </Button>
          </div>
        </div>

        {orderable && (
          <div className="flex shrink-0 gap-1 sm:flex-col">
            <Button
              variant="ghost"
              aria-label={t("c.classes.ClassCard.moveUp", { name: classWords(row.name) })}
              disabled={position === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              aria-label={t("c.classes.ClassCard.moveDown", { name: classWords(row.name) })}
              disabled={position === total - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {open && (
        <div className="mt-4 grid gap-6 border-t border-border-subtle pt-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t("c.classes.ClassCard.carsTitle")}</h3>

            {members.length === 0 ? (
              <p className="mt-2 text-sm text-ink-secondary">{t("c.classes.ClassCard.noCars")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border-subtle text-sm">
                {members.map((car) => (
                  <li key={car.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {car.make} {car.model}
                      <span className="ml-2 text-ink-muted">{car.license_plate}</span>
                    </span>
                    <Button variant="ghost" disabled={busy} onClick={() => takeOut(car)}>
                      {t("c.classes.ClassCard.takeOut")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">{t("c.classes.ClassCard.addCars")}</h3>
            <p className="mt-1 text-sm text-ink-secondary">
              {t("c.classes.ClassCard.priceNote", { price: formatCurrency(row.price_per_day) })}
            </p>

            {others.length === 0 || row.is_retired ? (
              <p className="mt-2 text-sm text-ink-secondary">{t("c.classes.ClassCard.nothingToAdd")}</p>
            ) : (
              <>
                <ul className="mt-2 max-h-56 divide-y divide-border-subtle overflow-y-auto text-sm">
                  {others.map((car) => (
                    <li key={car.id}>
                      <label className="flex cursor-pointer items-center gap-2 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                          checked={picked.has(car.id)}
                          onChange={(event) => {
                            const next = new Set(picked);

                            if (event.target.checked) next.add(car.id);
                            else next.delete(car.id);

                            setPicked(next);
                          }}
                        />
                        <span>
                          {car.make} {car.model}
                          <span className="ml-2 text-ink-muted">{car.license_plate}</span>
                        </span>
                        <span className="ml-auto text-xs text-ink-muted">
                          {car.class_id ? t("c.classes.ClassCard.movesFrom", { class: classNameOf(car.class_id) }) : t("c.classes.ClassCard.noClass")}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>

                <Button className="mt-3" variant="secondary" disabled={picked.size === 0 || busy} onClick={addPicked}>
                  {t("c.classes.ClassCard.addSelected", { count: picked.size })}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
