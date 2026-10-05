import type { Metadata } from "next";

import { ButtonLink } from "@/components/Button";
import { ThanksContent } from "@/components/ThanksContent";
import { brand } from "@/content/brand";
import { getTranslator } from "@/lib/i18n";
import { href } from "@/lib/links";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = getTranslator(lang);

  // Never in search results, whatever the site-wide setting.
  return { title: t("meta.thanksTitle", { brand: brand.name }), robots: { index: false, follow: false } };
}

export default async function Thanks({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);

  // The placeholders are filled in the browser, from what the visitor just sent.
  const copy = {
    heading: t("thanks.heading", { name: "{name}" }),
    headingGeneric: t("thanks.headingGeneric"),
    sub: t("thanks.sub", { email: "{email}" }),
    subGeneric: t("thanks.subGeneric"),
  };

  return (
    <main className="mx-auto max-w-300 px-4 py-20 md:py-28">
      <p className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 font-mono text-sm font-semibold uppercase tracking-wide text-accent-ink">
        <span aria-hidden="true">✓</span> {t("thanks.title")}
      </p>
      <div className="mt-6" role="status">
        <ThanksContent copy={copy} />
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-4">
        <ButtonLink href={href(lang, "/")} variant="dark">
          {t("thanks.home")}
        </ButtonLink>
        <ButtonLink href={`${href(lang, "/")}#pricing`} variant="outline">
          {t("thanks.pricing")}
        </ButtonLink>
      </div>
    </main>
  );
}
