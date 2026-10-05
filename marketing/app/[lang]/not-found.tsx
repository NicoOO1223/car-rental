import { DEFAULT_LANGUAGE } from "@shared/languages";

import { ButtonLink } from "@/components/Button";
import { getTranslator } from "@/lib/i18n";
import { contactEmail, href } from "@/lib/links";

export const metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  // Not given the language: the neutral wording is enough for a missing page.
  const t = getTranslator(DEFAULT_LANGUAGE);
  const email = contactEmail();

  return (
    <main className="mx-auto max-w-300 px-4 py-24">
      <p className="font-mono text-sm text-ink-muted">404</p>
      <h1 className="display mt-2 text-5xl font-bold">{t("notFound.title")}</h1>
      <p className="mt-4 max-w-xl text-lg text-ink-secondary">{t("notFound.body")}</p>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <ButtonLink href={href(DEFAULT_LANGUAGE, "/")} variant="dark">
          {t("notFound.home")}
        </ButtonLink>
        <ButtonLink href={href(DEFAULT_LANGUAGE, "/demo")} variant="outline">
          {t("notFound.demo")}
        </ButtonLink>
        {email && (
          <a href={`mailto:${email}`} className="underline underline-offset-4">
            {email}
          </a>
        )}
      </div>
    </main>
  );
}
