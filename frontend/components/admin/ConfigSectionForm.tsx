"use client";

import { useEffect, useState } from "react";

import {
  getConfiguration,
  updateConfiguration,
  type Configuration,
} from "@/lib/api";
import { setDefaultCurrency } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";

export type ConfigField = {
  key: keyof Configuration;
  label: string;
  kind: "integer" | "money" | "currency";
  /** Smallest allowed value; defaults to 0. */
  min?: number;
  hint?: string;
};

/**
 * One section of the Configuration panel: a card of fields that load from
 * and save to the configuration singleton. Only this section's own fields
 * are sent on save (the API accepts partial updates), so two sections can
 * never overwrite each other's values with stale ones.
 */
export function ConfigSectionForm({
  title,
  description,
  fields,
}: {
  title: string;
  description?: string;
  fields: ConfigField[];
}) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfiguration()
      .then((configuration) =>
        setValues(
          Object.fromEntries(
            fields.map((field) => [field.key, String(configuration[field.key])]),
          ),
        ),
      )
      .catch(() => setLoadError("Failed to load configuration."));
    // The field list is a constant of the calling page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!values) return;

    setSaving(true);
    setSaveError("");
    setSaved(false);

    try {
      const patch: Record<string, string | number> = {};

      for (const field of fields) {
        patch[field.key] =
          field.kind === "currency" ? values[field.key] : Number(values[field.key]);
      }

      const updated = await updateConfiguration(patch as Partial<Configuration>);

      setValues(
        Object.fromEntries(
          fields.map((field) => [field.key, String(updated[field.key])]),
        ),
      );
      setDefaultCurrency(updated.default_currency);
      setSaved(true);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to update configuration.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <Card>
        <p className="text-red-600" role="alert">
          {loadError}
        </p>
      </Card>
    );
  }

  if (!values) {
    return (
      <Card>
        <p className="text-ink-secondary">Loading configuration…</p>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>

          {description && (
            <p className="mt-1 text-sm text-ink-secondary">{description}</p>
          )}
        </div>

        {fields.map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            required
            hint={field.hint}
            {...(field.kind === "currency"
              ? { maxLength: 3 }
              : {
                  type: "number",
                  min: field.min ?? 0,
                  step: field.kind === "integer" ? 1 : "0.01",
                })}
            value={values[field.key]}
            onChange={(event) =>
              setValues({ ...values, [field.key]: event.target.value })
            }
          />
        ))}

        {saveError && (
          <p className="text-sm text-red-600" role="alert">
            {saveError}
          </p>
        )}

        {saved && !saveError && (
          <p className="text-sm text-ink-secondary">Saved.</p>
        )}

        <Button type="submit" loading={saving}>
          {saving ? "Saving" : "Save changes"}
        </Button>
      </Card>
    </form>
  );
}
