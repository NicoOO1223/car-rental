import type { Metadata } from "next";
import { Suspense } from "react";

import { ReturnStatus } from "@/components/booking/ReturnStatus";
import { getTranslator } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;

  return { title: getTranslator(lang)("meta.book"), robots: { index: false, follow: false } };
}

export default async function ReturnPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Suspense fallback={null}>
        <ReturnStatus language={lang} />
      </Suspense>
    </main>
  );
}
