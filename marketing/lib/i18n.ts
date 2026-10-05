import { createTranslator } from "use-intl/core";

import { DEFAULT_LANGUAGE, isLanguage, type Language } from "@shared/languages";

import en from "@/messages/en.json";

// Italian and Polish are added here, next to their catalogs, when they exist
// and a native speaker has read them (content/launch.ts ENABLED_LANGUAGES).
const CATALOGS: Partial<Record<Language, typeof en>> = { en };

export type Messages = typeof en;

function localeOf(language: string): Language {
  return isLanguage(language) && CATALOGS[language] ? language : DEFAULT_LANGUAGE;
}

export type Translator = (key: string, values?: Record<string, string | number>) => string;

/**
 * A translator for one language, for server components. Keys are plain
 * strings: much of the page builds its keys (features.<id>.b<n>, faq.q<n>), so
 * completeness is checked by tests/claims.test.ts and check:messages instead.
 */
export function getTranslator(language: string): Translator {
  const locale = localeOf(language);

  const translator = createTranslator({
    locale,
    messages: CATALOGS[locale] ?? en,
    // A message missing in one language shows its key rather than breaking the page.
    onError: () => {},
    getMessageFallback: ({ namespace, key }) => (namespace ? `${namespace}.${key}` : key),
  });

  return translator as unknown as Translator;
}
