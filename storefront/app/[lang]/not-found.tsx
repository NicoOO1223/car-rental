import { DEFAULT_LANGUAGE } from "@shared/languages";

import { getTranslator } from "@/lib/i18n";

export default function NotFound() {
  // Not given the language: the neutral wording is enough for a missing page.
  const t = getTranslator(DEFAULT_LANGUAGE);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="text-3xl font-bold">{t("notFound.title")}</h1>
      <p className="mt-3 text-ink-secondary">{t("notFound.body")}</p>
    </main>
  );
}
