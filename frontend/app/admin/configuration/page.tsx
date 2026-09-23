"use client";

import { useEffect, useState } from "react";

import { getConfiguration, updateConfiguration, type Configuration } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";

type FormState = {
  short_term_threshold_days: string;
  short_term_fee: string;
  airport_change_fee: string;
  default_currency: string;
  access_token_expire_days: string;
};

function toFormState(configuration: Configuration): FormState {
  return {
    short_term_threshold_days: String(configuration.short_term_threshold_days),
    short_term_fee: String(configuration.short_term_fee),
    airport_change_fee: String(configuration.airport_change_fee),
    default_currency: configuration.default_currency,
    access_token_expire_days: String(configuration.access_token_expire_days),
  };
}

export default function ConfigurationPage() {
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfiguration()
      .then((configuration) => setForm(toFormState(configuration)))
      .catch(() => setLoadError("Failed to load configuration."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;

    setSaving(true);
    setSaveError("");
    setSaved(false);

    try {
      const updated = await updateConfiguration({
        short_term_threshold_days: Number(form.short_term_threshold_days),
        short_term_fee: Number(form.short_term_fee),
        airport_change_fee: Number(form.airport_change_fee),
        default_currency: form.default_currency,
        access_token_expire_days: Number(form.access_token_expire_days),
      });
      setForm(toFormState(updated));
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
      <PageShell>
        <Card>
          <p className="text-red-600" role="alert">
            {loadError}
          </p>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Configuration"
        description="Business-rule values used when pricing a booking and issuing staff sessions."
      />

      {loading || !form ? (
        <Card>
          <p className="text-ink-secondary">Loading configuration…</p>
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-ink">Pricing</h2>

            <TextField
              label="Short-term rental threshold (days)"
              type="number"
              min={1}
              step={1}
              required
              hint="Rentals shorter than this many days incur the short-term fee below."
              value={form.short_term_threshold_days}
              onChange={(event) =>
                setForm({ ...form, short_term_threshold_days: event.target.value })
              }
            />

            <TextField
              label="Short-term fee"
              type="number"
              min={0}
              step="0.01"
              required
              value={form.short_term_fee}
              onChange={(event) =>
                setForm({ ...form, short_term_fee: event.target.value })
              }
            />

            <TextField
              label="Airport change fee"
              type="number"
              min={0}
              step="0.01"
              required
              hint="Applied when the pickup and return locations differ."
              value={form.airport_change_fee}
              onChange={(event) =>
                setForm({ ...form, airport_change_fee: event.target.value })
              }
            />

            <TextField
              label="Default currency"
              maxLength={3}
              required
              hint="3-letter code, e.g. eur."
              value={form.default_currency}
              onChange={(event) =>
                setForm({ ...form, default_currency: event.target.value })
              }
            />
          </Card>

          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-ink">Security</h2>

            <TextField
              label="Staff session length (days)"
              type="number"
              min={1}
              step={1}
              required
              hint="A staff member's login token is valid for this many days. Changing this only affects sessions started after the change — it does not shorten or extend a session already in progress."
              value={form.access_token_expire_days}
              onChange={(event) =>
                setForm({ ...form, access_token_expire_days: event.target.value })
              }
            />
          </Card>

          {saveError && (
            <p className="text-sm text-red-600" role="alert">
              {saveError}
            </p>
          )}
          {saved && !saveError && (
            <p className="text-sm text-ink-secondary">Configuration saved.</p>
          )}

          <Button type="submit" loading={saving}>
            {saving ? "Saving" : "Save changes"}
          </Button>
        </form>
      )}
    </PageShell>
  );
}
