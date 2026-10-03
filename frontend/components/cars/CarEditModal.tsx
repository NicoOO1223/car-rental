"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { CarImage } from "@/components/cars/CarImage";
import {
  carPhotoUrl,
  deleteCarPhoto,
  getCar,
  updateCar,
  uploadCarPhoto,
  type Car,
  type Location,
} from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t("c.cars.CarEditModal.couldNotReadFile")));
    reader.readAsDataURL(file);
  });
}

const CATEGORY_OPTIONS = [
  "ECONOMY",
  "COMPACT",
  "MIDSIZE",
  "PREMIUM",
  "SUV",
  "VAN",
];

const TRANSMISSION_OPTIONS = ["MANUAL", "AUTOMATIC"];

const FUEL_OPTIONS = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"];

type Props = {
  car: Car;
  locations: Location[];
  onClose: () => void;
  onSaved: (updated: Car) => void;
};

export function CarEditModal({ car, locations, onClose, onSaved }: Props) {
  const [make, setMake] = useState(car.make);
  const [model, setModel] = useState(car.model);
  const [year, setYear] = useState(String(car.year));
  const [licensePlate, setLicensePlate] = useState(car.license_plate);
  const [category, setCategory] = useState(car.category ?? "");
  const [transmission, setTransmission] = useState(car.transmission ?? "");
  const [fuelType, setFuelType] = useState(car.fuel_type ?? "");
  const [seats, setSeats] = useState(car.seats != null ? String(car.seats) : "");
  const [homeLocationId, setHomeLocationId] = useState(car.home_location.id);
  const [offeredOnline, setOfferedOnline] = useState(car.offered_online);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const photoFileInput = useRef<HTMLInputElement>(null);
  const [hasPhoto, setHasPhoto] = useState(car.has_photo);
  const [photoVersion, setPhotoVersion] = useState(car.photo_version);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");

  async function handlePhotoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPhotoError("");

    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setPhotoError(t("c.cars.CarEditModal.choosePngJpegImage"));
      return;
    }

    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(t("c.cars.CarEditModal.fileTooLargeLimit", { v1: MAX_PHOTO_BYTES / (1024 * 1024) }));
      return;
    }

    setPhotoBusy(true);

    try {
      await uploadCarPhoto(car.id, await readAsDataUrl(file));
      const updated = await getCar(car.id);
      setHasPhoto(updated.has_photo);
      setPhotoVersion(updated.photo_version);
      onSaved(updated);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : t("c.cars.CarEditModal.failedUploadPhoto"));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handlePhotoRemove() {
    setPhotoBusy(true);
    setPhotoError("");

    try {
      await deleteCarPhoto(car.id);
      const updated = await getCar(car.id);
      setHasPhoto(updated.has_photo);
      setPhotoVersion(updated.photo_version);
      onSaved(updated);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : t("c.cars.CarEditModal.failedRemovePhoto"));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const updated = await updateCar(car.id, {
        make,
        model,
        year: Number(year),
        license_plate: licensePlate,
        category: category || null,
        transmission: transmission || null,
        fuel_type: fuelType || null,
        seats: seats === "" ? null : Number(seats),
        home_location_id: homeLocationId,
        offered_online: offeredOnline,
      });

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.cars.CarEditModal.failedUpdateCar"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.cars.CarEditModal.editVehicle")}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.cars.CarEditModal.cancel")}</Button>
          <Button type="submit" form="car-edit-form" loading={saving}>
            {saving ? t("c.cars.CarEditModal.saving") : t("c.cars.CarEditModal.saveChanges")}
          </Button>
        </>
      }
    >
      <form id="car-edit-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("c.cars.CarEditModal.make")}
            required
            value={make}
            onChange={(event) => setMake(event.target.value)}
          />

          <TextField
            label={t("c.cars.CarEditModal.model")}
            required
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />

          <TextField
            label={t("c.cars.CarEditModal.year")}
            type="number"
            required
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />

          <TextField
            label={t("c.cars.CarEditModal.licensePlate")}
            required
            value={licensePlate}
            onChange={(event) => setLicensePlate(event.target.value)}
          />

          <SelectField
            label={t("c.cars.CarEditModal.category")}
            hint={t("c.cars.CarEditModal.drivesFallbackIllustrationBooking")}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{t("c.cars.CarEditModal.notSet")}</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <div>
            <p className="text-sm font-medium text-ink">{t("c.cars.CarEditModal.pricePerDay")}</p>

            <p className="mt-1.5 text-sm text-ink-secondary">{t("c.cars.CarEditModal.ratesManagedByAdmin", { v1: formatCurrency(car.price_per_day) })}</p>
          </div>

          <SelectField
            label={t("c.cars.CarEditModal.transmission")}
            value={transmission}
            onChange={(event) => setTransmission(event.target.value)}
          >
            <option value="">{t("c.cars.CarEditModal.notSet")}</option>
            {TRANSMISSION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={t("c.cars.CarEditModal.fuelType")}
            value={fuelType}
            onChange={(event) => setFuelType(event.target.value)}
          >
            <option value="">{t("c.cars.CarEditModal.notSet")}</option>
            {FUEL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>

          <TextField
            label={t("c.cars.CarEditModal.seats")}
            type="number"
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />

          <SelectField
            label={t("c.cars.CarEditModal.homeAirport")}
            className="sm:col-span-2"
            hint={t("c.cars.CarEditModal.whereCarBelongsIts")}
            value={homeLocationId}
            onChange={(event) => setHomeLocationId(event.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.airport_code} — {location.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={t("c.cars.CarEditModal.onlineBooking")}
            className="sm:col-span-2"
            hint={t("c.cars.CarEditModal.onlineBookingHint")}
            value={offeredOnline ? "yes" : "no"}
            onChange={(event) => setOfferedOnline(event.target.value === "yes")}
          >
            <option value="yes">{t("c.cars.CarEditModal.offeredOnline")}</option>
            <option value="no">{t("c.cars.CarEditModal.notOfferedOnline")}</option>
          </SelectField>
        </div>

        <div className="border-t border-border-subtle pt-5">
          <p className="text-sm font-medium text-ink">{t("c.cars.CarEditModal.photo")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{t("c.cars.CarEditModal.shownCustomersBookingFlow")}</p>

          <div className="mt-3 grid gap-4 sm:grid-cols-[9rem_1fr] sm:items-start">
            <CarImage
              imageUrl={hasPhoto ? carPhotoUrl(car.id, photoVersion) : null}
              category={category || null}
              alt={t("c.cars.CarEditModal.vehiclePreview")}
              className="aspect-[16/9] w-full rounded-lg"
            />

            <div className="flex flex-wrap items-start gap-3">
              <input
                ref={photoFileInput}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                onChange={handlePhotoFile}
                aria-label={t("c.cars.CarEditModal.choosePhotoFile")}
              />

              <Button
                type="button"
                variant="secondary"
                loading={photoBusy}
                onClick={() => photoFileInput.current?.click()}
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                {hasPhoto ? t("c.cars.CarEditModal.replacePhoto") : t("c.cars.CarEditModal.uploadPhoto")}
              </Button>

              {hasPhoto && (
                <Button type="button" variant="ghost" disabled={photoBusy} onClick={handlePhotoRemove}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />{t("c.cars.CarEditModal.removePhoto")}</Button>
              )}

              {photoError && (
                <p className="w-full text-sm text-red-600" role="alert">
                  {photoError}
                </p>
              )}
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
