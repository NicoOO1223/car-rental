"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";

/**
 * A vehicle's photo, with a category silhouette behind it.
 *
 * Most of the fleet has no image_url, and a broken or missing photo must
 * never leave a blank rectangle in a list a customer is choosing from. The
 * fallback is a drawn silhouette per body style, so an Economy car and an
 * SUV still read as different vehicles at a glance. A photo that fails to
 * load falls back to exactly the same thing.
 */

type BodyStyle = "hatchback" | "sedan" | "suv" | "van";

const CATEGORY_BODY_STYLE: Record<string, BodyStyle> = {
  ECONOMY: "hatchback",
  COMPACT: "hatchback",
  MIDSIZE: "sedan",
  PREMIUM: "sedan",
  SUV: "suv",
  VAN: "van",
};

/**
 * Side-profile outlines on a 200x100 canvas.
 *
 * Deliberately flat and monochrome, matching the rest of the app. The
 * four shapes differ in roofline height and length so an Economy car and
 * an SUV are told apart at a glance rather than reading as the same blob.
 */
const BODY_PATHS: Record<BodyStyle, string> = {
  // Short, stubby, steeply raked hatch.
  hatchback:
    "M34 68 L38 52 Q40 44 50 43 L96 41 Q106 41 113 47 L134 61 L160 64 Q168 65 168 70 L168 68 Z",
  // Longer, with a low roof and a drawn-out boot.
  sedan:
    "M18 68 L24 54 Q27 46 38 45 L92 41 Q104 41 113 48 L138 60 L178 65 Q186 66 186 71 L186 68 Z",
  // Tall greenhouse, high shoulder, boxy rear.
  suv:
    "M22 66 L26 36 Q28 28 40 27 L128 26 Q140 26 146 34 L162 52 L178 58 Q186 60 186 68 L186 66 Z",
  // Full-height slab side, near-vertical front.
  van:
    "M20 66 L21 26 Q22 18 34 18 L146 18 Q157 18 162 27 L176 52 Q186 57 186 68 L186 66 Z",
};

/** Wheel placement and size per body style. */
const WHEELS: Record<BodyStyle, { x: number[]; r: number }> = {
  hatchback: { x: [62, 142], r: 11 },
  sedan: { x: [56, 150], r: 11 },
  suv: { x: [58, 148], r: 15 },
  van: { x: [56, 152], r: 14 },
};

function bodyStyleFor(category: string | null): BodyStyle {
  if (!category) return "sedan";
  return CATEGORY_BODY_STYLE[category] ?? "sedan";
}

function CarSilhouette({ category }: { category: string | null }) {
  const style = bodyStyleFor(category);
  const wheels = WHEELS[style];

  return (
    <svg
      viewBox="0 0 200 100"
      className="h-full w-full"
      role="img"
      aria-label={t("c.cars.CarImage.vehicleIllustration")}
      preserveAspectRatio="xMidYMid meet"
    >
      <path d={BODY_PATHS[style]} className="fill-border-strong" />

      {wheels.x.map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={70} r={wheels.r} className="fill-ink-muted" />
          <circle
            cx={cx}
            cy={70}
            r={Math.round(wheels.r * 0.45)}
            className="fill-border-subtle"
          />
        </g>
      ))}

      {/* Ground line, so the shape reads as a vehicle rather than a blob. */}
      <rect
        x={12}
        y={84}
        width={176}
        height={2}
        rx={1}
        className="fill-border-subtle"
      />
    </svg>
  );
}

export function CarImage({
  imageUrl,
  category,
  alt,
  className = "",
  captionSpace = false,
}: {
  imageUrl: string | null;
  category: string | null;
  alt: string;
  className?: string;
  /**
   * Reserve room at the bottom for a caption band overlaid by the caller.
   * Only affects the fallback illustration: a photo stays full-bleed and
   * simply sits under the band, the way a photo caption normally works,
   * whereas a clipped silhouette just looks broken.
   */
  captionSpace?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  const showPhoto = Boolean(imageUrl) && !failed;

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-surface-sunken ${className}`}
    >
      {showPhoto ? (
        // A plain img rather than next/image: these are arbitrary
        // staff-pasted URLs from hosts that are not in an allowlist, and
        // next/image would reject or need remotePatterns for each one.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl as string}
          alt={alt}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center p-4 ${
            captionSpace ? "pb-11" : ""
          }`}
        >
          <CarSilhouette category={category} />
        </div>
      )}
    </div>
  );
}
