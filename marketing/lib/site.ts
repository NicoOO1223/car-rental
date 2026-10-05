import { brand } from "@/content/brand";
import { ENABLED_LANGUAGES } from "@/content/launch";

/**
 * The public address of the site, no trailing slash. Read when the site is
 * built, so the build for a deployment sets SITE_URL.
 */
export function siteUrl(): string | undefined {
  const url = process.env.SITE_URL?.trim();

  return url ? url.replace(/\/+$/, "") : undefined;
}

/**
 * Search engines may index the site only when the build says so AND the brand
 * is no longer a placeholder. Both are read at build time, so every page and
 * robots.txt agree.
 */
export function isIndexable(): boolean {
  return process.env.SITE_INDEXABLE === "true" && !brand.placeholder;
}

export function enabledLanguages(): readonly string[] {
  return ENABLED_LANGUAGES;
}
