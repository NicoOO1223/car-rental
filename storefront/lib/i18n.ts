import { createTranslator } from "use-intl/core";

import { DEFAULT_LANGUAGE, isLanguage, type Language } from "@shared/languages";

import en from "@/messages/en.json";
import it from "@/messages/it.json";
import pl from "@/messages/pl.json";

const CATALOGS = { en, it, pl } as const;

export type Messages = typeof en;

/** A translator for one language, for server components. */
export function getTranslator(language: string) {
  const locale: Language = isLanguage(language) ? language : DEFAULT_LANGUAGE;

  return createTranslator({
    locale,
    messages: CATALOGS[locale],
    // A message missing in one language shows its key rather than breaking the page.
    onError: () => {},
    getMessageFallback: ({ namespace, key }) => (namespace ? `${namespace}.${key}` : key),
  });
}
