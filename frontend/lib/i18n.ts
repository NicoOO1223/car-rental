/**
 * The interface language.
 *
 * Message catalogs live in frontend/messages/<language>.json, English being
 * the source every other language is translated from. Components use the
 * useTranslations() hook from use-intl; code that is not a component (the
 * API layer's error messages, constant lists in lib/) uses the plain `t`
 * exported here. Both read the same catalog, which components/
 * LanguageProvider.tsx keeps current, the same way components/
 * CurrencyProvider.tsx keeps lib/format.ts current.
 *
 * This is separate from lib/format.ts's locale, which only decides how
 * dates, times and money are written.
 */

import { createTranslator } from "use-intl/core";

export type Messages = { [key: string]: string | Messages };

export const LANGUAGES = [
  // Each language is named in itself, so someone who cannot read the current
  // language can still find theirs.
  { code: "en", label: "English" },
  { code: "it", label: "Italiano" },
  { code: "pl", label: "Polski" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

/** Development only: accented, lengthened English, to spot untranslated text. */
export const PSEUDO = "pseudo";

export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.code === value);
}

// --- Loading catalogs ---------------------------------------------------------

// Explicit imports, one per file, so the bundler emits a separate chunk for
// each language and only the chosen one is downloaded.
const loaders: Record<string, () => Promise<{ default: Messages }>> = {
  en: () => import("@/messages/en.json"),
  it: () => import("@/messages/it.json"),
  pl: () => import("@/messages/pl.json"),
};

/** Puts `override` over `base`, so a message missing from a translation
 * shows in English instead of as a bare key. */
function merge(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];

    result[key] =
      typeof value === "object" && typeof existing === "object"
        ? merge(existing, value)
        : value;
  }

  return result;
}

const ACCENTS: Record<string, string> = {
  a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", c: "ç", n: "ñ",
  A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", Y: "Ý", C: "Ç", N: "Ñ",
};

/**
 * Turns one message into pseudo-language: text outside ICU braces is
 * accented and padded, wrapped in ⟦ ⟧. The markers make it obvious on
 * screen which text came from the catalog: anything without them was never
 * extracted. The padding shows where longer translations would overflow.
 */
function pseudoMessage(message: string): string {
  let depth = 0;
  let out = "";

  for (const char of message) {
    if (char === "{") depth++;
    if (depth === 0) out += ACCENTS[char] ?? char;
    else out += char;
    if (char === "}") depth = Math.max(0, depth - 1);
  }

  return `⟦${out} ··⟧`;
}

function pseudoize(messages: Messages): Messages {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      key,
      typeof value === "string" ? pseudoMessage(value) : pseudoize(value),
    ]),
  );
}

/** The catalog for a language, with English filling any gaps. */
export async function loadMessages(language: string): Promise<Messages> {
  const english = (await loaders.en()).default;

  if (language === PSEUDO && process.env.NODE_ENV !== "production") {
    return pseudoize(english);
  }

  if (language === "en" || !loaders[language]) return english;

  return merge(english, (await loaders[language]()).default);
}

// --- The plain translator, for code that is not a component ---------------------

type Values = Record<string, string | number | Date>;

type Translator = ((key: string, values?: Values) => string) & {
  has: (key: string) => boolean;
};

let translator: Translator | null = null;
let active: string = DEFAULT_LANGUAGE;

/** Called by LanguageProvider whenever the language or catalog changes. */
export function setActiveLanguage(language: string, messages: Messages): void {
  active = language;
  translator = createTranslator({
    locale: language === PSEUDO ? "en" : language,
    messages,
    // A missing key shows the key itself. The build-time check
    // (scripts/check-messages.mjs) is what keeps that from shipping.
    onError: () => {},
    getMessageFallback: ({ namespace, key }) => (namespace ? `${namespace}.${key}` : key),
  }) as unknown as Translator;
}

export function getActiveLanguage(): string {
  return active;
}

/**
 * Translates outside React. Before a language has loaded it returns the key,
 * which only happens for code that runs before the provider is ready.
 */
export function t(key: string, values?: Values): string {
  return translator ? translator(key, values) : key;
}

/** Title-cases an enum value nobody has written a label for, rather than shouting it. */
export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The words for a value the server stores as an uppercase code, such as a
 * reservation's CONFIRMED. `group` is the catalog section under "enums".
 * A value with no label yet (a new status added on the server) still
 * shows as readable words instead of breaking the page.
 */
export function enumLabel(group: string, value: string | null | undefined): string {
  if (!value) return "";

  const key = `enums.${group}.${value}`;

  return translator?.has(key) ? translator(key) : humanize(value);
}
