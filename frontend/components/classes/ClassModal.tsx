"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { SelectField, TextField, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import {
  createVehicleClass,
  updateVehicleClass,
  type VehicleClass,
  type VehicleClassInput,
} from "@/lib/api";
import { getDefaultCurrency } from "@/lib/format";
import { LANGUAGES, t } from "@/lib/i18n";

type Props = {
  /** The class being edited; none to add a new one. */
  existing?: VehicleClass;
  onClose: () => void;
  onSaved: (saved: VehicleClass) => void;
};

/**
 * One class: its name and short description in each language (English is required,
 * the others fall back to it), the daily price every car in it is rented at, where
 * it sits in the list, and whether the website may offer it.
 */
export function ClassModal({ existing, onClose, onSaved }: Props) {
  const [name, setName] = useState<Record<string, string>>({ ...(existing?.name ?? {}) });
  const [description, setDescription] = useState<Record<string, string>>({ ...(existing?.description ?? {}) });
  const [price, setPrice] = useState(existing?.price_per_day ?? "");
  const [order, setOrder] = useState(String(existing?.sort_order ?? 0));
  const [online, setOnline] = useState(existing?.offered_online ?? true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    const input: VehicleClassInput = {
      name,
      description,
      price_per_day: price,
      sort_order: Number(order) || 0,
      offered_online: online,
    };

    try {
      onSaved(existing ? await updateVehicleClass(existing.id, input) : await createVehicleClass(input));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.classes.ClassModal.failedSave"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={existing ? t("c.classes.ClassModal.editTitle") : t("c.classes.ClassModal.addTitle")}
      description={t("c.classes.ClassModal.description")}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("c.classes.ClassModal.cancel")}
          </Button>
          <Button type="submit" form="class-form" loading={saving}>
            {t("c.classes.ClassModal.save")}
          </Button>
        </>
      }
    >
      <form id="class-form" onSubmit={handleSubmit} className="space-y-6">
        {LANGUAGES.map((language) => (
          <fieldset key={language.code} className="space-y-3 rounded-lg border border-border-subtle p-4">
            <legend className="px-1 text-sm font-semibold text-ink">{language.label}</legend>

            <TextField
              label={t("c.classes.ClassModal.name")}
              required={language.code === "en"}
              maxLength={80}
              value={name[language.code] ?? ""}
              onChange={(event) => setName({ ...name, [language.code]: event.target.value })}
            />

            <div>
              <label className="block text-sm font-medium text-ink" htmlFor={`class-description-${language.code}`}>
                {t("c.classes.ClassModal.descriptionLabel")}
              </label>
              <Textarea
                id={`class-description-${language.code}`}
                className="mt-1"
                rows={2}
                maxLength={500}
                value={description[language.code] ?? ""}
                onChange={(event) => setDescription({ ...description, [language.code]: event.target.value })}
              />
            </div>
          </fieldset>
        ))}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("c.classes.ClassModal.price", { currency: getDefaultCurrency() })}
            type="number"
            required
            min={0}
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />

          <TextField
            label={t("c.classes.ClassModal.order")}
            type="number"
            min={0}
            value={order}
            onChange={(event) => setOrder(event.target.value)}
          />

          <SelectField
            label={t("c.classes.ClassModal.online")}
            value={online ? "yes" : "no"}
            onChange={(event) => setOnline(event.target.value === "yes")}
          >
            <option value="yes">{t("c.classes.ClassModal.onlineYes")}</option>
            <option value="no">{t("c.classes.ClassModal.onlineNo")}</option>
          </SelectField>
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
