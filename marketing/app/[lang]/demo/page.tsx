import type { Metadata } from "next";

import { ButtonLink } from "@/components/Button";
import { brand } from "@/content/brand";
import { getTranslator } from "@/lib/i18n";
import { contactEmail, href } from "@/lib/links";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = getTranslator(lang);

  return { title: t("meta.demoTitle", { brand: brand.name }), description: t("meta.demoDescription") };
}

// Phase 1 placeholder: the request form (validation, bot checks, email) is built in phase 3.
export default async function Demo({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);
  const email = contactEmail();

  return (
    <main className="mx-auto max-w-300 px-4 py-16 md:py-24">
      <h1 className="display text-5xl font-bold md:text-6xl">{t("demo.title")}</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-secondary">{t("demo.sub")}</p>

      <div className="mt-10 max-w-xl rounded-2xl border border-border-subtle bg-surface p-7">
        <h2 className="display text-2xl font-bold">{t("demo.pendingTitle")}</h2>
        <p className="mt-2 text-ink-secondary">{t("demo.pendingBody")}</p>
        <p className="mt-4">
          {email ? (
            <a href={`mailto:${email}`} className="font-semibold underline underline-offset-4">
              {t("demo.emailUs", { email })}
            </a>
          ) : (
            <span className="text-ink-muted">{t("demo.noEmail")}</span>
          )}
        </p>
        <ButtonLink href={href(lang, "/")} variant="outline" className="mt-6">
          {t("demo.back")}
        </ButtonLink>
      </div>
    </main>
  );
}
