import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FleetCard } from "@/components/FleetCard";
import { getTranslator } from "@/lib/i18n";
import { getFleet, getPublicConfig } from "@/lib/publicApi";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;

  return { title: getTranslator(lang)("meta.fleet") };
}

export default async function FleetPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);
  const [config, fleet] = await Promise.all([getPublicConfig(), getFleet()]);

  if (!config?.storefront_enabled) notFound();

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("fleet.title")}</h1>
      <p className="mt-2 text-ink-secondary">{t("fleet.intro")}</p>

      {!fleet || fleet.length === 0 ? (
        <p className="mt-8 text-ink-secondary">{t("fleet.empty")}</p>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {fleet.map((vehicle) => (
            <FleetCard key={vehicle.offer_key} vehicle={vehicle} language={lang} bookHref={`/${lang}#top`} />
          ))}
        </ul>
      )}

      <Link
        href={`/${lang}`}
        className="mt-10 inline-block rounded-xl bg-gray-900 px-6 py-3.5 text-sm font-semibold text-white hover:bg-gray-800"
      >
        {t("fleet.search")}
      </Link>
    </main>
  );
}
