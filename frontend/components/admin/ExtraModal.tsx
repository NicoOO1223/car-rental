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
import type { ExtraWording } from "@/lib/extras";
import { LANGUAGES, t } from "@/lib/i18n";

// English is the wording on the extra itself; the others are optional.
const OTHER_LANGUAGES = LANGUAGES.filter((language) => language.code !== "en");

type Props = {
  /** The extra being edited; omit to add a new one. */
  extra?: AdminExtra;
  onClose: () => void;
  onSaved: () => void;
};

export function ExtraModal({ extra, onClose, onSaved }: Props) {
  const [name, setName] = useState(extra?.name ?? "");
  const [description, setDescription] = useState(extra?.description ?? "");
  const [words, setWords] = useState<ExtraWording>(extra?.translations ?? {});
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
      translations: words,
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
      setError(err instanceof Error ? err.message : t("c.admin.ExtraModal.failedSaveExtra"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={extra ? t("c.admin.ExtraModal.editExtra") : t("c.admin.ExtraModal.addExtra")}
      description={
        extra
          ? t("c.admin.ExtraModal.existingBookingsKeepPrice")
          : t("c.admin.ExtraModal.customersCanAddIt")
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.admin.ExtraModal.cancel")}</Button>
          <Button type="submit" form="extra-form" loading={saving}>
            {saving ? t("c.admin.ExtraModal.saving") : extra ? t("c.admin.ExtraModal.saveChanges") : t("c.admin.ExtraModal.addExtra2")}
          </Button>
        </>
      }
    >
      <form id="extra-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label={t("c.admin.ExtraModal.name")}
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <TextField
          label={t("c.admin.ExtraModal.description")}
          maxLength={255}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <fieldset className="space-y-3 rounded-lg border border-border-subtle p-3">
          <legend className="px-1 text-sm font-medium text-ink">
            {t("c.admin.ExtraModal.otherLanguages")}
          </legend>

          <p className="text-xs text-ink-muted">{t("c.admin.ExtraModal.otherLanguagesHint")}</p>

          {OTHER_LANGUAGES.map((language) => (
            <div key={language.code} className="grid gap-3 sm:grid-cols-2">
              <TextField
                label={t("c.admin.ExtraModal.nameIn", { language: language.label })}
                maxLength={100}
                value={words[language.code]?.name ?? ""}
                onChange={(event) =>
                  setWords({
                    ...words,
                    [language.code]: { ...words[language.code], name: event.target.value },
                  })
                }
              />

              <TextField
                label={t("c.admin.ExtraModal.descriptionIn", { language: language.label })}
                maxLength={255}
                value={words[language.code]?.description ?? ""}
                onChange={(event) =>
                  setWords({
                    ...words,
                    [language.code]: { ...words[language.code], description: event.target.value },
                  })
                }
              />
            </div>
          ))}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("c.admin.ExtraModal.price")}
            type="number"
            min={0}
            step="0.01"
            required
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />

          <SelectField
            label={t("c.admin.ExtraModal.charged")}
            value={priceUnit}
            onChange={(event) => setPriceUnit(event.target.value as PriceUnit)}
          >
            <option value="PER_DAY">{t("c.admin.ExtraModal.perDay")}</option>
            <option value="PER_RENTAL">{t("c.admin.ExtraModal.oncePerRental")}</option>
          </SelectField>

          <TextField
            label={t("c.admin.ExtraModal.maximumQuantity")}
            type="number"
            min={1}
            max={10}
            step={1}
            required
            hint={t("c.admin.ExtraModal.howManyCustomerCan")}
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
