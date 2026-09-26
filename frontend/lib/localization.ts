/**
 * The choices offered for the business's locale and timezone. The locale
 * list matches what the API accepts (backend/app/schemas/configuration.py,
 * SUPPORTED_LOCALES); it only changes how dates, times and money are
 * formatted, not the interface language.
 */
export const LOCALES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-US", label: "English (United States)" },
  { value: "it", label: "Italiano" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "nl", label: "Nederlands" },
  { value: "pl", label: "Polski" },
];

/**
 * IANA timezone names the browser knows, plus UTC and whatever value is
 * currently saved (so an unusual saved value is never silently dropped
 * from its own dropdown).
 */
export function timezoneOptions(current?: string): string[] {
  let names: string[] = [];

  try {
    names = Intl.supportedValuesOf("timeZone");
  } catch {
    names = [];
  }

  const all = new Set(["UTC", ...names]);

  if (current) all.add(current);

  return Array.from(all).sort((a, b) => {
    if (a === "UTC") return -1;
    if (b === "UTC") return 1;

    return a.localeCompare(b);
  });
}
