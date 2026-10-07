import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { VehicleArt } from "@/components/VehicleArt";
import { VehicleSpecs } from "@/components/VehicleSpecs";
import { formatMoney } from "@/lib/format";
import { getTranslator } from "@/lib/i18n";
import { getFleet, getPublicConfig } from "@/lib/publicApi";
import { carPhotoUrl } from "@/lib/runtime";
import { exampleCar, vehicleDescription, vehicleName } from "@/lib/vehicleText";

async function findClass(slug: string) {
  const fleet = await getFleet();

  return fleet?.find((vehicle) => vehicle.class_slug === slug) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const vehicle = await findClass(slug);

  if (!vehicle) return {};

  return { title: vehicleName(vehicle, lang), description: vehicleDescription(vehicle, lang) || undefined };
}

/** One vehicle class: what it is, what it costs a day, and the way to book it. */
export default async function ClassPage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  const t = getTranslator(lang);
  const [config, vehicle] = await Promise.all([getPublicConfig(), findClass(slug)]);

  if (!config?.storefront_enabled || !vehicle) notFound();

  const name = vehicleName(vehicle, lang);
  const example = exampleCar(vehicle, lang);
  const description = vehicleDescription(vehicle, lang);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href={`/${lang}/fleet`} className="text-sm text-ink-secondary hover:text-ink">
        ← {t("fleet.backToAll")}
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <VehicleArt
          imageUrl={vehicle.has_photo ? carPhotoUrl(vehicle.offer_key, vehicle.photo_version) : null}
          category={vehicle.category}
          alt={name}
          className="aspect-[4/3] w-full overflow-hidden rounded-2xl"
        />

        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>

          {example && (
            <p className="mt-1 text-ink-secondary">
              {example} {t("fleet.orSimilar")}
            </p>
          )}

          {description && <p className="mt-4 text-ink">{description}</p>}

          <div className="mt-5">
            <VehicleSpecs
              category={vehicle.category}
              transmission={vehicle.transmission}
              fuelType={vehicle.fuel_type}
              seats={vehicle.seats}
              transmissions={vehicle.transmissions}
              fuelTypes={vehicle.fuel_types}
              seatsMin={vehicle.seats_min}
              seatsMax={vehicle.seats_max}
            />
          </div>

          <p className="mt-6 text-2xl font-bold tabular-nums">
            {t("fleet.fromPrice", { price: formatMoney(vehicle.price_per_day, config.currency, lang) })}
          </p>

          <ul className="mt-4 space-y-1 text-sm text-ink-secondary">
            <li>{t("fleet.carAssigned")}</li>
            {config.free_cancellation_hours > 0 && (
              <li>{t("fleet.freeCancellation", { hours: config.free_cancellation_hours })}</li>
            )}
          </ul>

          <Link
            href={`/${lang}#top`}
            className="mt-8 inline-block rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-on-accent hover:bg-accent-hover"
          >
            {t("fleet.bookNow")}
          </Link>
        </div>
      </div>
    </main>
  );
}
