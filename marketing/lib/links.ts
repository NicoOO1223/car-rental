import { DEFAULT_LANGUAGE } from "@shared/languages";

import { brand, isTodo } from "@/content/brand";

/** A path on this site in a language: English has no prefix. */
export function href(language: string, path: string): string {
  const clean = path === "/" ? "" : path;

  return language === DEFAULT_LANGUAGE ? clean || "/" : `/${language}${clean}`;
}

/** The contact address, or null while it is still a placeholder. */
export function contactEmail(): string | null {
  return isTodo(brand.contactEmail) ? null : brand.contactEmail;
}
