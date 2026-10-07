"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import {
  createLocation,
  updateLocation,
  type Location,
} from "@/lib/api";
import { timezoneOptions } from "@/lib/localization";
import { t } from "@/lib/i18n";

type Props = {
  /** The location being edited; omit to add a new one. */
  location?: Location;
  /** Preselected for a new location: the business's own timezone. */
  defaultTimezone: string;
  onClose: () => void;
  onSaved: () => void;
};

export function LocationModal({
  location,
  defaultTimezone,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState(location?.name ?? "");
  const [code, setCode] = useState(location?.airport_code ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [timezone, setTimezone] = useState(location?.timezone ?? defaultTimezone);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    const payload = {
      name,
      airport_code: code,
      address,
      timezone,
    };

    try {
      if (location) {
        await updateLocation(location.id, payload);
      } else {
        await createLocation(payload);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.admin.LocationModal.failedSaveLocation"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={location ? t("c.admin.LocationModal.editLocation") : t("c.admin.LocationModal.addLocation")}
      description={
        location
          ? t("c.admin.LocationModal.timesDaysAtLocation")
          : t("c.admin.LocationModal.vehiclesCanBeBased")
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.admin.LocationModal.cancel")}</Button>
          <Button type="submit" form="location-form" loading={saving}>
            {saving ? t("c.admin.LocationModal.saving") : location ? t("c.admin.LocationModal.saveChanges") : t("c.admin.LocationModal.addLocation2")}
          </Button>
        </>
      }
    >
      <form id="location-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label={t("c.admin.LocationModal.name")}
          required
          maxLength={100}
          hint={t("c.admin.LocationModal.exampleOlbiaCostaSmeralda")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <TextField
          label={t("c.admin.LocationModal.code")}
          required
          minLength={2}
          maxLength={10}
          hint={t("c.admin.LocationModal.shortUniqueCodeSuch")}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />

        <TextField
          label={t("c.admin.LocationModal.address")}
          maxLength={255}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />

        <SelectField
          label={t("c.admin.LocationModal.timezone")}
          required
          hint={t("c.admin.LocationModal.whereLocationPickupReturn")}
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        >
          {timezoneOptions(timezone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </SelectField>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
