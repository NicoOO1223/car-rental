"use client";

import { useState } from "react";

// A car photo with a drawn silhouette behind it. Most cars have no photo, and a
// broken or missing one must never leave a blank rectangle in a list someone is
// choosing from. The silhouette follows the body style so an economy car and an
// SUV still look different.

type BodyStyle = "hatchback" | "sedan" | "suv" | "van";

const BODY_STYLE: Record<string, BodyStyle> = {
  ECONOMY: "hatchback",
  COMPACT: "hatchback",
  MIDSIZE: "sedan",
  PREMIUM: "sedan",
  SUV: "suv",
  VAN: "van",
};

const BODY_PATHS: Record<BodyStyle, string> = {
  hatchback: "M34 68 L38 52 Q40 44 50 43 L96 41 Q106 41 113 47 L134 61 L160 64 Q168 65 168 70 L168 68 Z",
  sedan: "M18 68 L24 54 Q27 46 38 45 L92 41 Q104 41 113 48 L138 60 L178 65 Q186 66 186 71 L186 68 Z",
  suv: "M22 66 L26 36 Q28 28 40 27 L128 26 Q140 26 146 34 L162 52 L178 58 Q186 60 186 68 L186 66 Z",
  van: "M20 66 L21 26 Q22 18 34 18 L146 18 Q157 18 162 27 L176 52 Q186 57 186 68 L186 66 Z",
};

const WHEELS: Record<BodyStyle, { x: number[]; r: number }> = {
  hatchback: { x: [62, 142], r: 11 },
  sedan: { x: [56, 150], r: 11 },
  suv: { x: [58, 148], r: 15 },
  van: { x: [56, 152], r: 14 },
};

export function VehicleArt({
  imageUrl,
  category,
  alt,
  className = "",
}: {
  imageUrl: string | null;
  category: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const style = BODY_STYLE[category ?? ""] ?? "sedan";
  const wheels = WHEELS[style];

  return (
    <div className={`relative flex items-center justify-center overflow-hidden bg-surface-sunken ${className}`}>
      {imageUrl && !failed ? (
        // The photo is an address the business pasted in, from any host, so a
        // plain image is used instead of the optimiser.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={alt} onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <svg viewBox="0 0 200 100" className="h-full w-full p-4" role="img" aria-label={alt} preserveAspectRatio="xMidYMid meet">
          <path d={BODY_PATHS[style]} className="fill-gray-300" />
          {wheels.x.map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy={70} r={wheels.r} className="fill-gray-400" />
              <circle cx={cx} cy={70} r={Math.round(wheels.r * 0.45)} className="fill-gray-200" />
            </g>
          ))}
          <rect x={12} y={84} width={176} height={2} rx={1} className="fill-gray-200" />
        </svg>
      )}
    </div>
  );
}
