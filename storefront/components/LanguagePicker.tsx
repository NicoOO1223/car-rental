"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "use-intl";

import { LANGUAGES, type Language } from "@shared/languages";

const NAMES: Record<Language, string> = { en: "English", it: "Italiano", pl: "Polski" };

/**
 * The same page in another language. Each choice is a plain link, so it works
 * before scripts load, and it is remembered for the next visit.
 */
export function LanguagePicker({ current }: { current: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const search = useSearchParams().toString();

  function hrefFor(language: Language): string {
    const rest = pathname.split("/").slice(2).join("/");

    return `/${language}${rest ? `/${rest}` : ""}${search ? `?${search}` : ""}`;
  }

  function remember(language: Language) {
    document.cookie = `storefront_language=${language}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <nav aria-label={t("language")} className="flex gap-1 text-sm">
      {LANGUAGES.map((language) => (
        <a
          key={language}
          href={hrefFor(language)}
          hrefLang={language}
          lang={language}
          aria-current={language === current ? "true" : undefined}
          onClick={() => remember(language)}
          className={`rounded-md px-2 py-1 ${
            language === current ? "bg-gray-900 font-medium text-white" : "text-ink-secondary hover:bg-surface hover:text-ink"
          }`}
        >
          {NAMES[language]}
        </a>
      ))}
    </nav>
  );
}
