import type { Metadata } from "next";
import { Suspense } from "react";

import { BookingView } from "@/components/booking/BookingView";
import { getTranslator } from "@/lib/i18n";

// One person booking: never for a search engine, and never keep the reference around.
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;

  return {
    title: getTranslator(lang)("booking.title"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function BookingPage({ params }: { params: Promise<{ lang: string; reference: string }> }) {
  const { lang, reference } = await params;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Suspense fallback={null}>
        <BookingView language={lang} reference={decodeURIComponent(reference)} />
      </Suspense>
    </main>
  );
}
