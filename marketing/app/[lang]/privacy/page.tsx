import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { brand } from "@/content/brand";
import { getTranslator } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = getTranslator(lang);

  return pageMetadata({ language: lang, path: "/privacy", title: t("meta.privacyTitle", { brand: brand.name }), description: t("meta.privacyDescription") });
}

export default async function Privacy({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;

  return <LegalPage language={lang} kind="privacy" sections={7} />;
}
