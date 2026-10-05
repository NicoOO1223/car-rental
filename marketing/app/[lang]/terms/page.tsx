import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { brand } from "@/content/brand";
import { getTranslator } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = getTranslator(lang);

  return pageMetadata({ language: lang, path: "/terms", title: t("meta.termsTitle", { brand: brand.name }), description: t("meta.termsDescription") });
}

export default async function Terms({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;

  return <LegalPage language={lang} kind="terms" sections={6} />;
}
