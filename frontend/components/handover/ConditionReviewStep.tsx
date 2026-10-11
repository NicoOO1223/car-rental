"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

import {
  addConditionReviewPhoto,
  fetchConditionPhotoBlob,
  getConditionReview,
  saveConditionReviewTireCondition,
  type ConditionReview,
  type ConditionReviewKind,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SelectField } from "@/components/ui/Field";
import { TIRE_CONDITION_OPTIONS } from "@/lib/tireCondition";
import { enumLabel, t } from "@/lib/i18n";

type Props = {
  reservationId: string;
  kind: ConditionReviewKind;
};

type Category = "EXTERIOR" | "INTERIOR";

type PhotoThumb = { id: string; category: Category; url: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t("c.handover.ConditionReviewStep.couldNotReadFile")));
    reader.readAsDataURL(file);
  });
}

/**
 * An optional step for both check-in and check-out: attach exterior/interior
 * photos, and, when the car comes back, reassess its tires (they are not
 * checked at pickup). Deliberately never gates payment, signature or
 * completion — see app/models/condition_review.py (backend) for why.
 */
export function ConditionReviewStep({ reservationId, kind }: Props) {
  const [review, setReview] = useState<ConditionReview | null>(null);
  const [tireCondition, setTireCondition] = useState("");
  const [thumbs, setThumbs] = useState<PhotoThumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTire, setSavingTire] = useState(false);
  const [uploading, setUploading] = useState<Category | null>(null);
  const [error, setError] = useState("");

  const exteriorInput = useRef<HTMLInputElement>(null);
  const interiorInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    getConditionReview(reservationId, kind)
      .then((loaded) => {
        if (cancelled) return;
        setReview(loaded);
        setTireCondition(loaded?.tire_condition ?? "");
      })
      .catch(() => {
        if (!cancelled) setError(t("c.handover.ConditionReviewStep.failedLoad"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reservationId, kind]);

  const photoIds = (review?.photos ?? []).map((photo) => photo.id).join(",");

  // Fetches each photo as an authenticated blob and keeps it as an object
  // URL for the <img> tags below, since a staff-only endpoint can't be
  // loaded by a plain <img src>. Re-runs only when the actual set of
  // photos changes, not on every render.
  useEffect(() => {
    let cancelled = false;
    const photos = review?.photos ?? [];

    Promise.all(
      photos.map(async (photo) => ({
        id: photo.id,
        category: photo.category,
        url: URL.createObjectURL(await fetchConditionPhotoBlob(photo.id)),
      })),
    ).then((loaded) => {
      if (cancelled) {
        loaded.forEach((thumb) => URL.revokeObjectURL(thumb.url));
        return;
      }

      setThumbs((previous) => {
        previous.forEach((thumb) => URL.revokeObjectURL(thumb.url));
        return loaded;
      });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoIds]);

  async function handleTireConditionChange(value: string) {
    setTireCondition(value);
    setSavingTire(true);
    setError("");

    try {
      const updated = await saveConditionReviewTireCondition(reservationId, kind, value || null);
      setReview(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.handover.ConditionReviewStep.failedSave"));
    } finally {
      setSavingTire(false);
    }
  }

  async function handlePhotoFile(category: Category, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError("");
    setUploading(category);

    try {
      const dataUrl = await readAsDataUrl(file);
      const updated = await addConditionReviewPhoto(reservationId, kind, category, dataUrl);
      setReview(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.handover.ConditionReviewStep.failedUpload"));
    } finally {
      setUploading(null);
    }
  }

  function photosFor(category: Category) {
    return thumbs.filter((thumb) => thumb.category === category);
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">{t("c.handover.ConditionReviewStep.title")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        {kind === "CHECK_OUT"
          ? t("c.handover.ConditionReviewStep.optionalHint")
          : t("c.handover.ConditionReviewStep.optionalHintPickup")}
      </p>

      <div className="mt-5 space-y-5">
        {/* Tires are only assessed when the car comes back. */}
        {kind === "CHECK_OUT" && (
          <SelectField
            label={t("c.handover.ConditionReviewStep.tireCondition")}
            disabled={loading || savingTire}
            value={tireCondition}
            onChange={(event) => handleTireConditionChange(event.target.value)}
          >
            <option value="">{t("c.handover.ConditionReviewStep.unknown")}</option>
            {TIRE_CONDITION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {enumLabel("tireCondition", option)}
              </option>
            ))}
          </SelectField>
        )}

        {/* Exterior and interior in one row, as plain groups (no boxes), each as wide as its
            photos need; the button to add one is below them. They wrap on a narrow screen. */}
        <div className="flex flex-wrap gap-x-10 gap-y-5">
          {(["EXTERIOR", "INTERIOR"] as const).map((category) => (
            <div key={category} className="flex min-w-0 flex-col">
              <p className="text-sm font-medium text-ink">
                {category === "EXTERIOR"
                  ? t("c.handover.ConditionReviewStep.exteriorPhotos")
                  : t("c.handover.ConditionReviewStep.interiorPhotos")}
              </p>

              {photosFor(category).length > 0 && (
                <div className="mt-2 flex max-w-[11rem] flex-wrap content-start gap-2">
                  {photosFor(category).map((thumb) => (
                    // eslint-disable-next-line @next/next/no-img-element -- an authenticated blob URL, not a static asset Next can optimize
                    <img key={thumb.id} src={thumb.url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                  ))}
                </div>
              )}

              <input
                ref={category === "EXTERIOR" ? exteriorInput : interiorInput}
                type="file"
                accept="image/png,image/jpeg"
                capture="environment"
                className="sr-only"
                onChange={(event) => handlePhotoFile(category, event)}
                aria-label={
                  category === "EXTERIOR"
                    ? t("c.handover.ConditionReviewStep.addExteriorPhoto")
                    : t("c.handover.ConditionReviewStep.addInteriorPhoto")
                }
              />

              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 self-start"
                loading={uploading === category}
                onClick={() => (category === "EXTERIOR" ? exteriorInput : interiorInput).current?.click()}
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                {t("c.handover.ConditionReviewStep.addPhoto")}
              </Button>
            </div>
          ))}
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
