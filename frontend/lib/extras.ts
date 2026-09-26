import { getActiveLanguage } from "@/lib/i18n";

/**
 * The wording of an extra (an add-on) in the language showing. An extra's
 * name and description are typed by the business, so the English text on the
 * extra itself is the source and the fallback, and each other language is an
 * optional override an admin can fill in.
 */

export type ExtraWording = Record<string, { name?: string | null; description?: string | null }>;

type Wordable = { code: string; name: string; description?: string | null; translations?: ExtraWording };

// Booked lines and price breakdowns carry only the extra's code and English
// name, so the wording seen on any response is remembered by code and used
// wherever that code is shown.
const known = new Map<string, ExtraWording>();

/** Remembers the other-language wording found on API responses. */
export function rememberExtras(items: { code?: string; extra_code?: string; translations?: ExtraWording }[]): void {
  for (const item of items) {
    const code = item.code ?? item.extra_code;

    if (code && item.translations) known.set(code, item.translations);
  }
}

function wording(code: string, translations?: ExtraWording) {
  const language = getActiveLanguage();

  return (translations ?? known.get(code) ?? {})[language] ?? {};
}

export function extraName(extra: Pick<Wordable, "code" | "name" | "translations">): string {
  return wording(extra.code, extra.translations).name || extra.name;
}

export function extraDescription(extra: Wordable): string | null {
  return wording(extra.code, extra.translations).description || extra.description || null;
}
