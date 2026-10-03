"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import {
  deleteLandingAboutImage,
  deleteLandingHero,
  getConfiguration,
  updateConfiguration,
  uploadLandingAboutImage,
  uploadLandingHero,
  type Configuration,
} from "@/lib/api";
import { useBrand } from "@/components/BrandProvider";
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

const SOCIAL_FIELDS = ["social_instagram_url", "social_facebook_url", "social_x_url", "social_whatsapp_url"] as const;

const LANDING_TEXT_FIELDS = [
  "landing_headline",
  "landing_tagline",
  "landing_benefit1_title",
  "landing_benefit1_body",
  "landing_benefit2_title",
  "landing_benefit2_body",
  "landing_benefit3_title",
  "landing_benefit3_body",
  "landing_about_title",
  "landing_about_body",
] as const;

const MAX_HERO_BYTES = 3 * 1024 * 1024;
const MAX_ABOUT_IMAGE_BYTES = 3 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t("s.admin.configuration.storefront.couldNotReadFile")));
    reader.readAsDataURL(file);
  });
}

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
  social_instagram_url: string;
  social_facebook_url: string;
  social_x_url: string;
  social_whatsapp_url: string;
  landing_headline: string;
  landing_tagline: string;
  landing_benefit1_title: string;
  landing_benefit1_body: string;
  landing_benefit2_title: string;
  landing_benefit2_body: string;
  landing_benefit3_title: string;
  landing_benefit3_body: string;
  landing_about_title: string;
  landing_about_body: string;
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
    social_instagram_url: configuration.social_instagram_url,
    social_facebook_url: configuration.social_facebook_url,
    social_x_url: configuration.social_x_url,
    social_whatsapp_url: configuration.social_whatsapp_url,
    landing_headline: configuration.landing_headline,
    landing_tagline: configuration.landing_tagline,
    landing_benefit1_title: configuration.landing_benefit1_title,
    landing_benefit1_body: configuration.landing_benefit1_body,
    landing_benefit2_title: configuration.landing_benefit2_title,
    landing_benefit2_body: configuration.landing_benefit2_body,
    landing_benefit3_title: configuration.landing_benefit3_title,
    landing_benefit3_body: configuration.landing_benefit3_body,
    landing_about_title: configuration.landing_about_title,
    landing_about_body: configuration.landing_about_body,
  };
}

export default function StorefrontConfigurationPage() {
  const brand = useBrand();
  const heroFileInput = useRef<HTMLInputElement>(null);
  const aboutFileInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<Form | null>(null);
  const [legalVersion, setLegalVersion] = useState(1);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [heroBusy, setHeroBusy] = useState(false);
  const [heroError, setHeroError] = useState("");

  const [aboutImageBusy, setAboutImageBusy] = useState(false);
  const [aboutImageError, setAboutImageError] = useState("");

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
      for (const key of LANDING_TEXT_FIELDS) patch[key] = form[key];
      for (const key of SOCIAL_FIELDS) patch[key] = form[key];

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

  async function handleHeroFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setHeroError("");

    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setHeroError(t("s.admin.configuration.storefront.choosePngJpegImage"));
      return;
    }

    if (file.size > MAX_HERO_BYTES) {
      setHeroError(t("s.admin.configuration.storefront.fileTooLargeLimit", { v1: MAX_HERO_BYTES / (1024 * 1024) }));
      return;
    }

    setHeroBusy(true);

    try {
      await uploadLandingHero(await readAsDataUrl(file));
      brand.refresh();
    } catch (err) {
      setHeroError(err instanceof Error ? err.message : t("s.admin.configuration.storefront.failedUploadHero"));
    } finally {
      setHeroBusy(false);
    }
  }

  async function handleHeroRemove() {
    setHeroBusy(true);
    setHeroError("");

    try {
      await deleteLandingHero();
      brand.refresh();
    } catch (err) {
      setHeroError(err instanceof Error ? err.message : t("s.admin.configuration.storefront.failedRemoveHero"));
    } finally {
      setHeroBusy(false);
    }
  }

  async function handleAboutImageFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAboutImageError("");

    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setAboutImageError(t("s.admin.configuration.storefront.choosePngJpegImage"));
      return;
    }

    if (file.size > MAX_ABOUT_IMAGE_BYTES) {
      setAboutImageError(
        t("s.admin.configuration.storefront.fileTooLargeLimit", { v1: MAX_ABOUT_IMAGE_BYTES / (1024 * 1024) }),
      );
      return;
    }

    setAboutImageBusy(true);

    try {
      await uploadLandingAboutImage(await readAsDataUrl(file));
      brand.refresh();
    } catch (err) {
      setAboutImageError(
        err instanceof Error ? err.message : t("s.admin.configuration.storefront.failedUploadAboutImage"),
      );
    } finally {
      setAboutImageBusy(false);
    }
  }

  async function handleAboutImageRemove() {
    setAboutImageBusy(true);
    setAboutImageError("");

    try {
      await deleteLandingAboutImage();
      brand.refresh();
    } catch (err) {
      setAboutImageError(
        err instanceof Error ? err.message : t("s.admin.configuration.storefront.failedRemoveAboutImage"),
      );
    } finally {
      setAboutImageBusy(false);
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
    <>
      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.storefront.landingTitle")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.storefront.landingDescription")}</p>
        </div>

        <div className="flex items-center gap-4">
          {brand.heroImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.heroImageUrl}
              alt=""
              aria-hidden="true"
              className="h-16 w-28 shrink-0 rounded-lg border border-border-strong object-cover"
            />
          ) : (
            <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong text-xs text-ink-muted">
              {t("s.admin.configuration.storefront.noHeroImage")}
            </div>
          )}

          <input
            ref={heroFileInput}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={handleHeroFile}
            aria-label={t("s.admin.configuration.storefront.chooseHeroFile")}
          />

          <Button
            type="button"
            variant="secondary"
            loading={heroBusy}
            onClick={() => heroFileInput.current?.click()}
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            {brand.heroImageUrl ? t("s.admin.configuration.storefront.replaceHero") : t("s.admin.configuration.storefront.uploadHero")}
          </Button>

          {brand.heroImageUrl && (
            <Button type="button" variant="ghost" disabled={heroBusy} onClick={handleHeroRemove}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />{t("s.admin.configuration.storefront.remove")}</Button>
          )}
        </div>

        {heroError && (
          <p className="text-sm text-red-600" role="alert">
            {heroError}
          </p>
        )}

        <TextField
          label={t("s.admin.configuration.storefront.landingHeadline")}
          hint={t("s.admin.configuration.storefront.landingHeadlineHint")}
          maxLength={150}
          value={form.landing_headline}
          onChange={set("landing_headline")}
        />

        <TextField
          label={t("s.admin.configuration.storefront.landingTagline")}
          maxLength={300}
          value={form.landing_tagline}
          onChange={set("landing_tagline")}
        />

        <p className="text-sm font-medium text-ink">{t("s.admin.configuration.storefront.landingBenefitsHint")}</p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <TextField
              label={t("s.admin.configuration.storefront.landingBenefitTitle", { n: 1 })}
              maxLength={80}
              value={form.landing_benefit1_title}
              onChange={set("landing_benefit1_title")}
            />
            <Textarea
              rows={3}
              maxLength={240}
              placeholder={t("s.admin.configuration.storefront.landingBenefitBody")}
              value={form.landing_benefit1_body}
              onChange={set("landing_benefit1_body")}
            />
          </div>

          <div className="space-y-2">
            <TextField
              label={t("s.admin.configuration.storefront.landingBenefitTitle", { n: 2 })}
              maxLength={80}
              value={form.landing_benefit2_title}
              onChange={set("landing_benefit2_title")}
            />
            <Textarea
              rows={3}
              maxLength={240}
              placeholder={t("s.admin.configuration.storefront.landingBenefitBody")}
              value={form.landing_benefit2_body}
              onChange={set("landing_benefit2_body")}
            />
          </div>

          <div className="space-y-2">
            <TextField
              label={t("s.admin.configuration.storefront.landingBenefitTitle", { n: 3 })}
              maxLength={80}
              value={form.landing_benefit3_title}
              onChange={set("landing_benefit3_title")}
            />
            <Textarea
              rows={3}
              maxLength={240}
              placeholder={t("s.admin.configuration.storefront.landingBenefitBody")}
              value={form.landing_benefit3_body}
              onChange={set("landing_benefit3_body")}
            />
          </div>
        </div>

        <div className="border-t border-border-subtle pt-4">
          <p className="text-sm font-medium text-ink">{t("s.admin.configuration.storefront.landingAboutHint")}</p>

          <div className="mt-4 flex items-center gap-4">
            {brand.aboutImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.aboutImageUrl}
                alt=""
                aria-hidden="true"
                className="h-16 w-28 shrink-0 rounded-lg border border-border-strong object-cover"
              />
            ) : (
              <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong text-xs text-ink-muted">
                {t("s.admin.configuration.storefront.noAboutImage")}
              </div>
            )}

            <input
              ref={aboutFileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={handleAboutImageFile}
              aria-label={t("s.admin.configuration.storefront.chooseAboutImageFile")}
            />

            <Button
              type="button"
              variant="secondary"
              loading={aboutImageBusy}
              onClick={() => aboutFileInput.current?.click()}
            >
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              {brand.aboutImageUrl
                ? t("s.admin.configuration.storefront.replaceAboutImage")
                : t("s.admin.configuration.storefront.uploadAboutImage")}
            </Button>

            {brand.aboutImageUrl && (
              <Button type="button" variant="ghost" disabled={aboutImageBusy} onClick={handleAboutImageRemove}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />{t("s.admin.configuration.storefront.remove")}</Button>
            )}
          </div>

          {aboutImageError && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {aboutImageError}
            </p>
          )}

          <TextField
            label={t("s.admin.configuration.storefront.landingAboutTitle")}
            maxLength={100}
            value={form.landing_about_title}
            onChange={set("landing_about_title")}
            className="mt-4"
          />

          <Field label={t("s.admin.configuration.storefront.landingAboutBody")}>
            {(fieldProps) => (
              <Textarea {...fieldProps} rows={4} maxLength={600} value={form.landing_about_body} onChange={set("landing_about_body")} />
            )}
          </Field>
        </div>
      </Card>

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
          <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.storefront.socialTitle")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.storefront.socialDescription")}</p>
        </div>

        <TextField
          label={t("s.admin.configuration.storefront.socialInstagram")}
          hint={t("s.admin.configuration.storefront.urlHint")}
          maxLength={500}
          value={form.social_instagram_url}
          onChange={set("social_instagram_url")}
        />

        <TextField
          label={t("s.admin.configuration.storefront.socialFacebook")}
          hint={t("s.admin.configuration.storefront.urlHint")}
          maxLength={500}
          value={form.social_facebook_url}
          onChange={set("social_facebook_url")}
        />

        <TextField
          label={t("s.admin.configuration.storefront.socialX")}
          hint={t("s.admin.configuration.storefront.urlHint")}
          maxLength={500}
          value={form.social_x_url}
          onChange={set("social_x_url")}
        />

        <TextField
          label={t("s.admin.configuration.storefront.socialWhatsapp")}
          hint={t("s.admin.configuration.storefront.urlHint")}
          maxLength={500}
          value={form.social_whatsapp_url}
          onChange={set("social_whatsapp_url")}
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
    </>
  );
}
