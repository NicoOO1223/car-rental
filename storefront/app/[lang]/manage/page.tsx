import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";

import { LookupForm } from "@/components/booking/LookupForm";
import { getTranslator } from "@/lib/i18n";
import { getPublicConfig } from "@/lib/publicApi";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;

  return { title: getTranslator(lang)("meta.manage"), robots: { index: false, follow: false } };
}

export default async function ManagePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const config = await getPublicConfig();

  if (!config?.storefront_enabled) notFound();

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Suspense fallback={null}>
        <LookupForm language={lang} />
      </Suspense>
    </main>
  );
}
