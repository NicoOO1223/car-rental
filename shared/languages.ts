// Shared by the apps in this repository. Pure TypeScript with no imports, so
// each app can read it straight from this folder (see storefront/next.config.ts).

/** English is the source language; the others are translated from it. */
export const LANGUAGES = ["en", "it", "pl"] as const;

export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(value: string | null | undefined): value is Language {
  return LANGUAGES.includes(value as Language);
}

/**
 * The language to show a visitor who has not chosen one: the first language in
 * their Accept-Language header that we have, else `fallback`.
 */
export function negotiateLanguage(
  acceptLanguage: string | null | undefined,
  fallback: Language = DEFAULT_LANGUAGE,
): Language {
  if (!acceptLanguage) return fallback;

  const wanted = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params.map((p) => p.trim()).find((p) => p.startsWith("q="));

      return { code: tag.trim().toLowerCase().split("-")[0], quality: quality ? Number(quality.slice(2)) : 1 };
    })
    .filter((entry) => entry.code && !Number.isNaN(entry.quality) && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  return wanted.map((entry) => entry.code).find(isLanguage) ?? fallback;
}
