"use client";

import { useEffect, useState } from "react";

import { getConfiguration, updateConfiguration, type Configuration } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, SelectField, TextField, Textarea } from "@/components/ui/Field";
import { t } from "@/lib/i18n";

const NUMBER_FIELDS = [
  "online_share_percent",
  "free_cancellation_hours",
  "hold_minutes",
  "min_booking_lead_hours",
] as const;

const TEXT_FIELDS = ["terms_text", "terms_url", "privacy_text", "privacy_url"] as const;

type Form = {
  storefront_enabled: boolean;
  online_share_percent: string;
  free_cancellation_hours: string;
  hold_minutes: string;
  min_booking_lead_hours: string;
  terms_text: string;
  terms_url: string;
  privacy_text: string;
  privacy_url: string;
};

function toForm(configuration: Configuration): Form {
  return {
    storefront_enabled: configuration.storefront_enabled,
    online_share_percent: String(configuration.online_share_percent),
    free_cancellation_hours: String(configuration.free_cancellation_hours),
    hold_minutes: String(configuration.hold_minutes),
    min_booking_lead_hours: String(configuration.min_booking_lead_hours),
    terms_text: configuration.terms_text,
    terms_url: configuration.terms_url,
    privacy_text: configuration.privacy_text,
    privacy_url: configuration.privacy_url,
  };
}

export default function StorefrontConfigurationPage() {
  const [form, setForm] = useState<Form | null>(null);
  const [legalVersion, setLegalVersion] = useState(1);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfiguration()
      .then((configuration) => {
        setForm(toForm(configuration));
        setLegalVersion(configuration.legal_version);
      })
      .catch(() => setLoadError(t("s.admin.configuration.storefront.failedLoad")));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;

    setSaving(true);
    setSaveError("");
    setSaved(false);

    try {
      const patch: Partial<Configuration> = { storefront_enabled: form.storefront_enabled };

      for (const key of NUMBER_FIELDS) patch[key] = Number(form[key]);
      for (const key of TEXT_FIELDS) patch[key] = form[key];

      const updated = await updateConfiguration(patch);

      setForm(toForm(updated));
      setLegalVersion(updated.legal_version);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("s.admin.configuration.storefront.failedSave"));
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

  if (!form) {
    return (
      <Card>
        <p className="text-ink-secondary">{t("s.admin.configuration.storefront.loading")}</p>
      </Card>
    );
  }

  const set =
    (key: keyof Form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: event.target.value });

  const missingLegal = form.storefront_enabled && !form.terms_text.trim() && !form.terms_url.trim();

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.storefront.title")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.storefront.description")}</p>
        </div>

        <SelectField
          label={t("s.admin.configuration.storefront.onlineBooking")}
          hint={t("s.admin.configuration.storefront.onlineBookingHint")}
          value={form.storefront_enabled ? "on" : "off"}
          onChange={(event) => setForm({ ...form, storefront_enabled: event.target.value === "on" })}
        >
          <option value="off">{t("s.admin.configuration.storefront.off")}</option>
          <option value="on">{t("s.admin.configuration.storefront.on")}</option>
        </SelectField>

        {missingLegal && (
          <p className="rounded-lg bg-gray-100 p-3 text-sm text-gray-700">
            {t("s.admin.configuration.storefront.missingTerms")}
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.storefront.rulesTitle")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.storefront.rulesDescription")}</p>
        </div>

        <TextField
          label={t("s.admin.configuration.storefront.onlineShare")}
          hint={t("s.admin.configuration.storefront.onlineShareHint")}
          type="number"
          min={1}
          max={100}
          step={1}
          required
          value={form.online_share_percent}
          onChange={set("online_share_percent")}
        />

        <TextField
          label={t("s.admin.configuration.storefront.freeCancellation")}
          hint={t("s.admin.configuration.storefront.freeCancellationHint")}
          type="number"
          min={0}
          max={720}
          step={1}
          required
          value={form.free_cancellation_hours}
          onChange={set("free_cancellation_hours")}
        />

        <TextField
          label={t("s.admin.configuration.storefront.holdMinutes")}
          hint={t("s.admin.configuration.storefront.holdMinutesHint")}
          type="number"
          min={5}
          max={60}
          step={1}
          required
          value={form.hold_minutes}
          onChange={set("hold_minutes")}
        />

        <TextField
          label={t("s.admin.configuration.storefront.leadTime")}
          hint={t("s.admin.configuration.storefront.leadTimeHint")}
          type="number"
          min={0}
          max={720}
          step={1}
          required
          value={form.min_booking_lead_hours}
          onChange={set("min_booking_lead_hours")}
        />
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.storefront.legalTitle")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {t("s.admin.configuration.storefront.legalDescription", { version: legalVersion })}
          </p>
        </div>

        <Field label={t("s.admin.configuration.storefront.termsText")}>
          {(fieldProps) => (
            <Textarea {...fieldProps} rows={8} maxLength={20000} value={form.terms_text} onChange={set("terms_text")} />
          )}
        </Field>

        <TextField
          label={t("s.admin.configuration.storefront.termsUrl")}
          hint={t("s.admin.configuration.storefront.urlHint")}
          maxLength={500}
          value={form.terms_url}
          onChange={set("terms_url")}
        />

        <Field label={t("s.admin.configuration.storefront.privacyText")}>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={8}
              maxLength={20000}
              value={form.privacy_text}
              onChange={set("privacy_text")}
            />
          )}
        </Field>

        <TextField
          label={t("s.admin.configuration.storefront.privacyUrl")}
          hint={t("s.admin.configuration.storefront.urlHint")}
          maxLength={500}
          value={form.privacy_url}
          onChange={set("privacy_url")}
        />

        {saveError && (
          <p className="text-sm text-red-600" role="alert">
            {saveError}
          </p>
        )}

        {saved && !saveError && (
          <p className="text-sm text-ink-secondary">{t("s.admin.configuration.storefront.saved")}</p>
        )}

        <Button type="submit" loading={saving}>
          {saving ? t("s.admin.configuration.storefront.saving") : t("s.admin.configuration.storefront.save")}
        </Button>
      </Card>
    </form>
  );
}
