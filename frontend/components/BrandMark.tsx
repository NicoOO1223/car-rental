"use client";

import { brandInitials, useBrand } from "@/components/BrandProvider";

/**
 * The logo if one is uploaded, otherwise a tile with the business's
 * initials. Sized by the caller with a Tailwind size class.
 */
export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  const { name, logoUrl } = useBrand();

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        aria-hidden="true"
        className={`${className} shrink-0 rounded-lg object-contain`}
      />
    );
  }

  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white`}
      aria-hidden="true"
    >
      {brandInitials(name)}
    </span>
  );
}
