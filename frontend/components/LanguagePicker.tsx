"use client";

import { useState } from "react";
import { useTranslations } from "use-intl";
import { Languages } from "lucide-react";

import { useLanguage } from "@/components/LanguageProvider";
import { LANGUAGES, PSEUDO } from "@/lib/i18n";

/**
 * Chooses the interface language. When someone is signed in the choice is
 * saved to their account and follows them to any device; on the sign-in page
 * it is remembered on this device only.
 *
 * `compact` shows just the icon and language code, for the collapsed sidebar.
 */
export function LanguagePicker({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("language");
  const { language, setLanguage } = useLanguage();
  const [error, setError] = useState(false);

  const options: { code: string; label: string }[] = [...LANGUAGES];

  // A development aid for finding text that was never extracted; not shipped.
  if (process.env.NODE_ENV !== "production") {
    options.push({ code: PSEUDO, label: "Pseudo (dev)" });
  }

  async function handleChange(next: string) {
    setError(false);

    try {
      await setLanguage(next);
    } catch {
      // The account could not be updated; the language stays as it was.
      setError(true);
    }
  }

  return (
    <label className={`flex items-center gap-2 text-sm text-ink-secondary ${className}`}>
      <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t("choose")}</span>

      <select
        value={language}
        onChange={(event) => handleChange(event.target.value)}
        aria-label={t("choose")}
        aria-invalid={error || undefined}
        className={`rounded-md border border-border-strong bg-surface py-1 pl-2 pr-6 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
          compact ? "w-16" : "min-w-0 flex-1"
        }`}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {compact ? option.code.toUpperCase() : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
