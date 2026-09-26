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
      setError(err instanceof Error ? err.message : "Failed to save the location.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={location ? "Edit location" : "Add a location"}
      description={
        location
          ? "Times and days at this location follow its timezone."
          : "Vehicles can be based at it and picked up from it straight away."
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="location-form" loading={saving}>
            {saving ? "Saving" : location ? "Save changes" : "Add location"}
          </Button>
        </>
      }
    >
      <form id="location-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Name"
          required
          maxLength={100}
          hint="For example: Olbia Costa Smeralda Airport."
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <TextField
          label="Code"
          required
          minLength={2}
          maxLength={10}
          hint="A short unique code, such as OLB. Shown in tables and filters."
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />

        <TextField
          label="Address"
          maxLength={255}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />

        <SelectField
          label="Timezone"
          required
          hint="Where this location is. Pickup and return times are set and shown in it."
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
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
