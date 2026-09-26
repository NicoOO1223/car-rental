import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";

import { BookingWizard } from "@/components/booking/BookingWizard";
import { getTranslator } from "@/lib/i18n";
import { getPublicConfig } from "@/lib/publicApi";

// A step in someone booking, not a page to be found in a search engine.
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;

  return { title: getTranslator(lang)("meta.book"), robots: { index: false, follow: false } };
}

export default async function BookPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const config = await getPublicConfig();

  if (!config?.storefront_enabled) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Suspense fallback={null}>
        <BookingWizard language={lang} holdMinutes={config.hold_minutes} />
      </Suspense>
    </main>
  );
}
