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

import { t, LANGUAGES } from "@/lib/i18n";
import { LOCALES, timezoneOptions } from "@/lib/localization";
import { AccentColorField } from "@/components/admin/AccentColorField";
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
  "accent_color",
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
    reader.onerror = () => reject(new Error(t("s.admin.configuration.business.couldNotReadFile")));
    reader.readAsDataURL(file);
  });
}

export default function BusinessConfigurationPage() {
  const brand = useBrand();
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
      .catch(() => setLoadError(t("s.admin.configuration.business.failedLoadConfiguration")));
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
        err instanceof Error ? err.message : t("s.admin.configuration.business.failedUpdateConfiguration"),
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
      setLogoError(t("s.admin.configuration.business.choosePngJpegImage"));
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(t("s.admin.configuration.business.fileTooLargeLimit", { v1: MAX_LOGO_BYTES / 1024 }));
      return;
    }

    setLogoBusy(true);

    try {
      await uploadLogo(await readAsDataUrl(file));
      brand.refresh();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : t("s.admin.configuration.business.failedUploadLogo"));
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
      setLogoError(err instanceof Error ? err.message : t("s.admin.configuration.business.failedRemoveLogo"));
    } finally {
      setLogoBusy(false);
    }
  }

  if (loadError) {
    return (
      <Card>
        <p className="text-danger" role="alert">
          {loadError}
        </p>
      </Card>
    );
  }

  if (!profile) {
    return (
      <Card>
        <p className="text-ink-secondary">{t("s.admin.configuration.business.loadingConfiguration")}</p>
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
          <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.business.logo")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.business.shownSignPageSidebar", { v1: MAX_LOGO_BYTES / 1024 })}</p>
        </div>

        <div className="flex items-center gap-4">
          <BrandMark className="h-16 w-16" />

          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={handleLogoFile}
            aria-label={t("s.admin.configuration.business.chooseLogoFile")}
          />

          <Button
            type="button"
            variant="secondary"
            loading={logoBusy}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            {brand.logoUrl ? t("s.admin.configuration.business.replaceLogo") : t("s.admin.configuration.business.uploadLogo")}
          </Button>

          {brand.logoUrl && (
            <Button
              type="button"
              variant="ghost"
              disabled={logoBusy}
              onClick={handleLogoRemove}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />{t("s.admin.configuration.business.remove")}</Button>
          )}
        </div>

        {logoError && (
          <p className="text-sm text-danger" role="alert">
            {logoError}
          </p>
        )}
      </Card>

      <form onSubmit={handleSave} className="space-y-6">
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.business.businessProfile")}</h2>
            <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.business.printedAtTopAgreements")}</p>
          </div>

          <TextField
            label={t("s.admin.configuration.business.businessName")}
            required
            maxLength={100}
            hint={t("s.admin.configuration.business.shownSignPageSidebar2")}
            value={profile.business_name}
            onChange={set("business_name")}
          />

          <AccentColorField
            value={profile.accent_color}
            onChange={(accent_color) => {
              setProfile({ ...profile, accent_color });
              setSaved(false);
            }}
          />

          <TextField
            label={t("s.admin.configuration.business.legalName")}
            maxLength={150}
            hint={t("s.admin.configuration.business.registeredCompanyNameIf")}
            value={profile.legal_name}
            onChange={set("legal_name")}
          />

          <Field label={t("s.admin.configuration.business.address")}>
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
              label={t("s.admin.configuration.business.phone")}
              maxLength={50}
              value={profile.phone}
              onChange={set("phone")}
            />
            <TextField
              label={t("s.admin.configuration.business.email")}
              type="email"
              maxLength={150}
              value={profile.email}
              onChange={set("email")}
            />
          </div>

          <TextField
            label={t("s.admin.configuration.business.vatId")}
            maxLength={50}
            value={profile.vat_id}
            onChange={set("vat_id")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t("s.admin.configuration.business.timezone")}
              hint={t("s.admin.configuration.business.businessDefaultEachLocation")}
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
              label={t("s.admin.configuration.business.format")}
              hint={t("s.admin.configuration.business.howDatesTimesAmounts")}
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
              label={t("config.business.defaultLanguage")}
              hint={t("config.business.defaultLanguageHint")}
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
              label={t("config.business.documentLanguage")}
              hint={t("config.business.documentLanguageHint")}
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
            <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.business.vatInvoices")}</h2>
            <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.business.singleVatRateEverything")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("s.admin.configuration.business.vatRate")}
              type="number"
              min={0}
              max={100}
              step="0.01"
              hint={t("s.admin.configuration.business.0ShowsNoVat")}
              value={vatRateText}
              onChange={(event) => setVatRateInput(event.target.value)}
            />

            <SelectField
              label={t("s.admin.configuration.business.prices")}
              hint={t("s.admin.configuration.business.whetherPricesYouSet")}
              value={profile.prices_include_vat ? "include" : "exclude"}
              onChange={(event) =>
                setProfile({
                  ...profile,
                  prices_include_vat: event.target.value === "include",
                })
              }
            >
              <option value="include">{t("s.admin.configuration.business.includeVat")}</option>
              <option value="exclude">{t("s.admin.configuration.business.excludeVatAddedAt")}</option>
            </SelectField>
          </div>

          <TextField
            label={t("s.admin.configuration.business.invoiceNumberPrefix")}
            maxLength={10}
            hint={t("s.admin.configuration.business.numbersLookLikeInv")}
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
            <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.business.agreementTerms")}</h2>
            <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.business.wordingPrintedUnderTerms")}</p>
          </div>

          <Field label={t("s.admin.configuration.business.terms")}>
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
            <p className="text-sm text-danger" role="alert">
              {saveError}
            </p>
          )}

          {saved && !saveError && (
            <p className="text-sm text-ink-secondary">{t("s.admin.configuration.business.saved")}</p>
          )}

          <Button type="submit" loading={saving}>
            {saving ? t("s.admin.configuration.business.saving") : t("s.admin.configuration.business.saveChanges")}
          </Button>
        </Card>
      </form>
    </>
  );
}
