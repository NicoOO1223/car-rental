import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { getTranslator } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;

  return { title: getTranslator(lang)("meta.terms") };
}

export default async function TermsPage({ params }: { params: Promise<{ lang: string }> }) {
  return <LegalPage language={(await params).lang} kind="terms" />;
}
