"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import {
  createExtra,
  updateExtra,
  type AdminExtra,
  type PriceUnit,
} from "@/lib/api";

type Props = {
  /** The extra being edited; omit to add a new one. */
  extra?: AdminExtra;
  onClose: () => void;
  onSaved: () => void;
};

export function ExtraModal({ extra, onClose, onSaved }: Props) {
  const [name, setName] = useState(extra?.name ?? "");
  const [description, setDescription] = useState(extra?.description ?? "");
  const [price, setPrice] = useState(extra ? String(extra.price) : "");
  const [priceUnit, setPriceUnit] = useState<PriceUnit>(extra?.price_unit ?? "PER_DAY");
  const [maxQuantity, setMaxQuantity] = useState(
    extra ? String(extra.max_quantity) : "1",
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    const payload = {
      name,
      description: description || null,
      price,
      price_unit: priceUnit,
      max_quantity: Number(maxQuantity),
    };

    try {
      if (extra) {
        await updateExtra(extra.id, payload);
      } else {
        await createExtra(payload);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the extra.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={extra ? "Edit extra" : "Add an extra"}
      description={
        extra
          ? "Existing bookings keep the price they were booked at."
          : "Customers can add it to a booking straight away."
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="extra-form" loading={saving}>
            {saving ? "Saving" : extra ? "Save changes" : "Add extra"}
          </Button>
        </>
      }
    >
      <form id="extra-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Name"
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <TextField
          label="Description"
          maxLength={255}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Price"
            type="number"
            min={0}
            step="0.01"
            required
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />

          <SelectField
            label="Charged"
            value={priceUnit}
            onChange={(event) => setPriceUnit(event.target.value as PriceUnit)}
          >
            <option value="PER_DAY">Per day</option>
            <option value="PER_RENTAL">Once per rental</option>
          </SelectField>

          <TextField
            label="Maximum quantity"
            type="number"
            min={1}
            max={10}
            step={1}
            required
            hint="How many a customer can add to one booking."
            value={maxQuantity}
            onChange={(event) => setMaxQuantity(event.target.value)}
          />
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
