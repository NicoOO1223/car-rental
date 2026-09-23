import * as Flags from "country-flag-icons/react/3x2";

import { countryName } from "@/lib/countries";

/**
 * Renders an ISO alpha-2 code as an actual flag icon (SVG), rather than a
 * Unicode flag emoji — Windows/Segoe UI Emoji doesn't compose regional
 * indicator symbol pairs into flag glyphs, so that approach showed raw
 * two-letter text (e.g. "ES") instead of a flag.
 */
export function CountryFlag({
  code,
  className = "h-3.5 w-auto shrink-0",
}: {
  code: string | null | undefined;
  className?: string;
}) {
  if (!code) return null;

  const Flag = Flags[code.toUpperCase() as keyof typeof Flags];
  if (!Flag) return null;

  return (
    <Flag
      className={className}
      title={countryName(code)}
      aria-label={countryName(code)}
    />
  );
}
