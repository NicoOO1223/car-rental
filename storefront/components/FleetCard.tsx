import Link from "next/link";

import type { PublicVehicle } from "@shared/publicApi";

import { VehicleArt } from "@/components/VehicleArt";
import { VehicleSpecs } from "@/components/VehicleSpecs";
import { getTranslator } from "@/lib/i18n";
import { carPhotoUrl } from "@/lib/runtime";

/**
 * A kind of car you can book. The name sits on top of the photo, the Book now
 * button at its bottom left, and the car's categories underneath.
 */
export function FleetCard({
  vehicle,
  language,
  bookHref,
}: {
  vehicle: PublicVehicle;
  language: string;
  /** Where Book now goes: a page, or a `#anchor` on the page already open. */
  bookHref: string;
}) {
  const t = getTranslator(language);
  const name = `${vehicle.make} ${vehicle.model}`;

  const button =
    "inline-flex items-center rounded-xl border-2 border-white bg-transparent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40";

  return (
    <li className="group overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
      <div className="relative overflow-hidden">
        <VehicleArt
          imageUrl={vehicle.has_photo ? carPhotoUrl(vehicle.offer_key, vehicle.photo_version) : null}
          category={vehicle.category}
          alt={name}
          className="aspect-[4/3] w-full transition-transform duration-500 group-hover:scale-105"
        />

        {/* Darkens the top and bottom of the photo so the white text reads on any picture. */}
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-black/65"
          aria-hidden="true"
        />

        <div className="absolute inset-x-0 top-0 p-5 text-white">
          <h3 className="text-xl font-semibold">{name}</h3>
          <p className="text-sm text-white/80">{t("fleet.orSimilar")}</p>
        </div>

        <div className="absolute bottom-0 left-0 p-5">
          {bookHref.startsWith("#") ? (
            <a href={bookHref} className={button}>
              {t("fleet.bookNow")}
            </a>
          ) : (
            <Link href={bookHref} className={button}>
              {t("fleet.bookNow")}
            </Link>
          )}
        </div>
      </div>

      <div className="p-5">
        <VehicleSpecs
          category={vehicle.category}
          transmission={vehicle.transmission}
          fuelType={vehicle.fuel_type}
          seats={vehicle.seats}
        />
      </div>
    </li>
  );
}
