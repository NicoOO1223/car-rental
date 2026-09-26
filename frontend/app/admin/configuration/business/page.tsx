"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import {
  deleteLogo,
  getConfiguration,
  updateConfiguration,
  uploadLogo,
  type Configuration,
} from "@/lib/api";
import { useTranslations } from "use-intl";

import { LANGUAGES } from "@/lib/i18n";
import { LOCALES, timezoneOptions } from "@/lib/localization";
import { BrandMark } from "@/components/BrandMark";
import { useBrand } from "@/components/BrandProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, SelectField, TextField, Textarea } from "@/components/ui/Field";

const PROFILE_FIELDS = [
  "business_name",
  "legal_name",
  "address",
  "phone",
  "email",
  "vat_id",
  "timezone",
  "locale",
  "default_language",
  "document_language",
  "agreement_terms",
  "vat_rate",
  "prices_include_vat",
  "invoice_prefix",
] as const;

type Profile = Pick<Configuration, (typeof PROFILE_FIELDS)[number]>;

const MAX_LOGO_BYTES = 300 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

export default function BusinessConfigurationPage() {
  const brand = useBrand();
  const t = useTranslations("config.business");
  const fileInput = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [vatRateInput, setVatRateInput] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");

  useEffect(() => {
    getConfiguration()
      .then((configuration) =>
        setProfile(
          Object.fromEntries(
            PROFILE_FIELDS.map((key) => [key, configuration[key]]),
          ) as Profile,
        ),
      )
      .catch(() => setLoadError("Failed to load configuration."));
  }, []);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!profile) return;

    setSaving(true);
    setSaveError("");
    setSaved(false);

    try {
      const updated = await updateConfiguration({
        ...profile,
        vat_rate: Number(vatRateInput ?? profile.vat_rate),
      });
      setVatRateInput(null);

      setProfile(
        Object.fromEntries(
          PROFILE_FIELDS.map((key) => [key, updated[key]]),
        ) as Profile,
      );
      setSaved(true);
      // The sidebar, login page and tab title read the name from here.
      brand.refresh();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to update configuration.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLogoError("");

    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setLogoError("Choose a PNG or JPEG image.");
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(`That file is too large. The limit is ${MAX_LOGO_BYTES / 1024} KB.`);
      return;
    }

    setLogoBusy(true);

    try {
      await uploadLogo(await readAsDataUrl(file));
      brand.refresh();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Failed to upload the logo.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleLogoRemove() {
    setLogoBusy(true);
    setLogoError("");

    try {
      await deleteLogo();
      brand.refresh();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Failed to remove the logo.");
    } finally {
      setLogoBusy(false);
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

  if (!profile) {
    return (
      <Card>
        <p className="text-ink-secondary">Loading configuration…</p>
      </Card>
    );
  }

  const set =
    (key: keyof Profile) =>
    (event: { target: { value: string } }) =>
      setProfile({ ...profile, [key]: event.target.value });

  // VAT is the two fields that are not text: a percentage and a yes or no.
  // The rate is held as typed so a half-entered "7." is not rewritten.
  const vatRateText = vatRateInput ?? String(profile.vat_rate);

  return (
    <>
      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Logo</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Shown on the sign-in page and in the sidebar, and printed on
            agreements. PNG or JPEG, up to {MAX_LOGO_BYTES / 1024} KB.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <BrandMark className="h-16 w-16" />

          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={handleLogoFile}
            aria-label="Choose a logo file"
          />

          <Button
            type="button"
            variant="secondary"
            loading={logoBusy}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            {brand.logoUrl ? "Replace logo" : "Upload logo"}
          </Button>

          {brand.logoUrl && (
            <Button
              type="button"
              variant="ghost"
              disabled={logoBusy}
              onClick={handleLogoRemove}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>

        {logoError && (
          <p className="text-sm text-red-600" role="alert">
            {logoError}
          </p>
        )}
      </Card>

      <form onSubmit={handleSave} className="space-y-6">
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Business profile</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              Printed at the top of agreements. Leave a field empty to leave
              it off.
            </p>
          </div>

          <TextField
            label="Business name"
            required
            maxLength={100}
            hint="Shown on the sign-in page, the sidebar and the browser tab."
            value={profile.business_name}
            onChange={set("business_name")}
          />

          <TextField
            label="Legal name"
            maxLength={150}
            hint="The registered company name, if different."
            value={profile.legal_name}
            onChange={set("legal_name")}
          />

          <Field label="Address">
            {(fieldProps) => (
              <Textarea
                {...fieldProps}
                rows={3}
                maxLength={500}
                value={profile.address}
                onChange={set("address")}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Phone"
              maxLength={50}
              value={profile.phone}
              onChange={set("phone")}
            />
            <TextField
              label="Email"
              type="email"
              maxLength={150}
              value={profile.email}
              onChange={set("email")}
            />
          </div>

          <TextField
            label="VAT ID"
            maxLength={50}
            value={profile.vat_id}
            onChange={set("vat_id")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Timezone"
              hint="The business default. Each location can set its own."
              value={profile.timezone}
              onChange={set("timezone")}
            >
              {timezoneOptions(profile.timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Format"
              hint="How dates, times and amounts are written. The interface stays in English."
              value={profile.locale}
              onChange={set("locale")}
            >
              {LOCALES.map((locale) => (
                <option key={locale.value} value={locale.value}>
                  {locale.label}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t("defaultLanguage")}
              hint={t("defaultLanguageHint")}
              value={profile.default_language}
              onChange={set("default_language")}
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </SelectField>

            <SelectField
              label={t("documentLanguage")}
              hint={t("documentLanguageHint")}
              value={profile.document_language}
              onChange={set("document_language")}
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </SelectField>
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">VAT and invoices</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              A single VAT rate for everything you charge. An invoice is
              issued automatically when a rental is paid, and a credit note
              if it is refunded. Invoices never change after they are issued.
              Ask your accountant which rate and setting apply to you.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="VAT rate (%)"
              type="number"
              min={0}
              max={100}
              step="0.01"
              hint="0 shows no VAT."
              value={vatRateText}
              onChange={(event) => setVatRateInput(event.target.value)}
            />

            <SelectField
              label="Prices"
              hint="Whether the prices you set already contain VAT."
              value={profile.prices_include_vat ? "include" : "exclude"}
              onChange={(event) =>
                setProfile({
                  ...profile,
                  prices_include_vat: event.target.value === "include",
                })
              }
            >
              <option value="include">Include VAT</option>
              <option value="exclude">Exclude VAT (added at checkout)</option>
            </SelectField>
          </div>

          <TextField
            label="Invoice number prefix"
            maxLength={10}
            hint="Numbers look like INV-000001. Credit notes use CN."
            value={profile.invoice_prefix}
            onChange={(event) =>
              setProfile({
                ...profile,
                invoice_prefix: event.target.value.toUpperCase(),
              })
            }
          />
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Agreement terms</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              The wording printed under Terms &amp; Conditions on every rental
              agreement. Have it reviewed by a lawyer. Leave empty to use the
              built-in placeholder text.
            </p>
          </div>

          <Field label="Terms">
            {(fieldProps) => (
              <Textarea
                {...fieldProps}
                rows={10}
                maxLength={10000}
                value={profile.agreement_terms}
                onChange={set("agreement_terms")}
              />
            )}
          </Field>

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
    </>
  );
}
