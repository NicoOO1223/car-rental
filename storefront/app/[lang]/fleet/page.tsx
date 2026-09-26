import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { VehicleArt } from "@/components/VehicleArt";
import { VehicleSpecs } from "@/components/VehicleSpecs";
import { formatMoney } from "@/lib/format";
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
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("fleet.title")}</h1>
      <p className="mt-2 text-ink-secondary">{t("fleet.intro")}</p>

      {!fleet || fleet.length === 0 ? (
        <p className="mt-8 text-ink-secondary">{t("fleet.empty")}</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fleet.map((vehicle) => (
            <li key={`${vehicle.make}-${vehicle.model}-${vehicle.year}-${vehicle.price_per_day}`} className="overflow-hidden rounded-xl bg-surface shadow-sm">
              <VehicleArt
                imageUrl={vehicle.image_url}
                category={vehicle.category}
                alt={`${vehicle.make} ${vehicle.model}`}
                className="aspect-[16/9] w-full"
              />

              <div className="space-y-2 p-4">
                <h2 className="font-semibold">
                  {vehicle.make} {vehicle.model}
                </h2>
                <VehicleSpecs
                  category={vehicle.category}
                  transmission={vehicle.transmission}
                  fuelType={vehicle.fuel_type}
                  seats={vehicle.seats}
                />
                <p className="text-sm font-medium">{t("fleet.perDay", { price: formatMoney(vehicle.price_per_day, config.currency, lang) })}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/${lang}`}
        className="mt-8 inline-block rounded-lg bg-gray-900 px-5 py-3 text-sm font-medium text-white hover:bg-gray-800"
      >
        {t("fleet.search")}
      </Link>
    </main>
  );
}
