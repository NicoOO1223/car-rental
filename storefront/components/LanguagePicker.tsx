"use client";

import { Check, ChevronDown, Globe } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "use-intl";

import { LANGUAGES, type Language } from "@shared/languages";

import { Menu } from "@/components/Menu";

const NAMES: Record<Language, string> = { en: "English", it: "Italiano", pl: "Polski" };

/**
 * The same page in another language, in a dropdown. Each choice is a plain
 * link, so it works before scripts load, and it is remembered for the next visit.
 */
export function LanguagePicker({ current, className = "" }: { current: string; className?: string }) {
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
    <Menu
      label={t("language")}
      triggerClassName={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-current ${className}`}
      trigger={
        <>
          <Globe className="h-4 w-4" aria-hidden="true" />
          <span className="uppercase">{current}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </>
      }
    >
      <ul role="list">
        {LANGUAGES.map((language) => (
          <li key={language}>
            <a
              href={hrefFor(language)}
              hrefLang={language}
              lang={language}
              aria-current={language === current ? "true" : undefined}
              onClick={() => remember(language)}
              className="flex items-center justify-between gap-6 px-4 py-2 hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
            >
              <span className={language === current ? "font-semibold" : ""}>{NAMES[language]}</span>
              {language === current && <Check className="h-4 w-4" aria-hidden="true" />}
            </a>
          </li>
        ))}
      </ul>
    </Menu>
  );
}
