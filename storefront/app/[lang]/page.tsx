import { ArrowRight, CalendarCheck, Check, CreditCard, MapPin, UserCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { SearchForm } from "@/components/SearchForm";
import { VehicleArt } from "@/components/VehicleArt";
import { VehicleSpecs } from "@/components/VehicleSpecs";
import { getAccount } from "@/lib/accountServer";
import { formatMoney } from "@/lib/format";
import { getTranslator } from "@/lib/i18n";
import { getFleet, getLocations, getPublicConfig } from "@/lib/publicApi";
import { carPhotoUrl, runtimeConfig } from "@/lib/runtime";

const FEATURE_ICONS = [CreditCard, CalendarCheck, UserCheck];

export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);
  const [config, locations, fleet, account] = await Promise.all([getPublicConfig(), getLocations(), getFleet(), getAccount()]);

  // The API cannot be reached, or the admin has not switched online booking on.
  if (!config || !config.storefront_enabled) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-4 py-16">
        <h1 className="text-3xl font-bold">{config ? t("unavailable.title") : t("unreachable.title")}</h1>

        <p className="mt-3 text-ink-secondary">{config ? t("unavailable.body") : t("unreachable.body")}</p>
      </main>
    );
  }

  // Written once by the business, in their own language — never run
  // through this catalog, unlike every surrounding label.
  const headline = config.landing_headline || t("home.title");
  const tagline = config.landing_tagline || t("home.subtitle");

  // The business's own words when it has written them, else the standard three.
  const written = [
    { title: config.landing_benefit1_title, body: config.landing_benefit1_body },
    { title: config.landing_benefit2_title, body: config.landing_benefit2_body },
    { title: config.landing_benefit3_title, body: config.landing_benefit3_body },
  ].filter((benefit) => benefit.title.trim() || benefit.body.trim());

  const features =
    written.length > 0
      ? written
      : [
          { title: t("home.point1Title"), body: t("home.point1Body", { percent: config.online_share_percent }) },
          { title: t("home.point2Title"), body: t("home.point2Body", { hours: config.free_cancellation_hours }) },
          { title: t("home.point3Title"), body: t("home.point3Body") },
        ];

  const featuredFleet = (fleet ?? []).slice(0, 3);
  const places = locations ?? [];

  // Photos the business uploaded in its admin; the built-in ones are the fallback.
  const api = runtimeConfig().apiUrl;
  const heroImageUrl = config.has_hero_image ? `${api}/api/branding/landing-hero?v=${config.hero_image_version ?? 0}` : null;
  const ctaImageUrl = config.has_landing_cta_image
    ? `${api}/api/branding/landing-cta-image?v=${config.landing_cta_image_version ?? 0}`
    : null;

  const aboutImageUrl = config.has_landing_about_image
    ? `${runtimeConfig().apiUrl}/api/branding/landing-about-image?v=${config.landing_about_image_version ?? 0}`
    : null;
  const aboutTitle = config.landing_about_title.trim() || t("home.aboutFallbackTitle");
  const aboutBody = config.landing_about_body.trim() || t("home.aboutFallbackBody");

  return (
    <main id="top" className="relative isolate">
      {/* The photo runs behind the transparent navbar and the booking bar. */}
      <div className="absolute inset-x-0 top-0 -z-10 h-[46rem] overflow-hidden bg-deep sm:h-[54rem]" aria-hidden="true">
        {heroImageUrl ? (
          // The photo is served by the business's own API, so the image optimiser is not used.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroImageUrl} alt="" fetchPriority="high" className="h-full w-full object-cover" />
        ) : (
          <Image src="/hero.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/25 to-black/60" />
      </div>

      {/* The booking bar sits at the top of the hero, then sticks to the top of the screen. */}
      <SearchForm language={lang} locations={places} minLeadHours={config.min_booking_lead_hours}
        manageHref={`/${lang}/${account ? "account" : "manage"}`}
      />

      <section className="flex min-h-[34rem] items-end sm:min-h-[40rem]">
        <div className="mx-auto w-full max-w-7xl px-4 pb-16 text-white sm:px-6 sm:pb-20">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl">{headline}</h1>
          <p className="mt-4 max-w-2xl text-lg text-white/85 sm:text-xl">{tagline}</p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 pb-8 pt-14 sm:px-6 sm:pb-10 sm:pt-20" aria-labelledby="features-title">
        <h2 id="features-title" className="sr-only">
          {t("home.featuresTitle")}
        </h2>

        <div className="grid gap-10 md:grid-cols-3 md:gap-12">
          {features.map((feature, index) => {
            const Icon = FEATURE_ICONS[index % FEATURE_ICONS.length];

            return (
              <div key={index}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {feature.title && <h3 className="text-base font-semibold text-ink-secondary">{feature.title}</h3>}
                </div>
                {feature.body && <p className="mt-4 text-xl font-semibold leading-snug text-ink">{feature.body}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Our fleet: big pictures, straight from the fleet the business manages. */}
      {featuredFleet.length > 0 && (
        <section className="border-t border-border-subtle bg-surface" aria-labelledby="fleet-title">
          <div className="mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-14">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="fleet-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {t("home.fleetTitle")}
                </h2>
                <p className="mt-2 text-lg text-ink-secondary">{t("home.fleetSubtitle")}</p>
              </div>

              <Link
                href={`/${lang}/fleet`}
                className="hidden items-center gap-2 rounded-xl border border-border-strong px-5 py-3 text-sm font-semibold hover:bg-surface-sunken sm:inline-flex"
              >
                {t("home.fleetCta")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <ul className="mt-10 grid gap-6 md:grid-cols-3">
              {featuredFleet.map((vehicle) => (
                <li key={vehicle.offer_key} className="group overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
                  <div className="overflow-hidden">
                    <VehicleArt
                      imageUrl={vehicle.has_photo ? carPhotoUrl(vehicle.offer_key, vehicle.photo_version) : null}
                      category={vehicle.category}
                      alt={`${vehicle.make} ${vehicle.model}`}
                      className="aspect-[4/3] w-full transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>

                  <div className="p-5">
                    <p className="text-xl font-semibold">
                      {vehicle.make} {vehicle.model}
                    </p>
                    <div className="mt-2 text-sm text-ink-secondary">
                      <VehicleSpecs
                        category={vehicle.category}
                        transmission={vehicle.transmission}
                        fuelType={vehicle.fuel_type}
                        seats={vehicle.seats}
                      />
                    </div>
                    <p className="mt-3 text-sm font-medium">
                      {t("home.perDay", { price: formatMoney(vehicle.price_per_day, config.currency, lang) })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <Link
              href={`/${lang}/fleet`}
              className="mt-8 flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-3.5 text-sm font-semibold text-white hover:bg-gray-800 sm:hidden"
            >
              {t("home.fleetCta")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}

      {/* About us, on the dark surface so it stands apart from the white sections around it. */}
      <section className="bg-deep text-on-deep" aria-labelledby="about-title">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2">
          <div>
            <h2 id="about-title" className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              {aboutTitle}
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-on-deep-muted">{aboutBody}</p>

            <ul className="mt-8 space-y-3">
              {[t("home.aboutPoint1"), t("home.aboutPoint2"), t("home.aboutPoint3")].map((point) => (
                <li key={point} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-deep-raised">
            {aboutImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={aboutImageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Image src="/about.jpg" alt="" fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
            )}
          </div>
        </div>
      </section>

      {/* Locations */}
      {places.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24" aria-labelledby="locations-title">
          <h2 id="locations-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("home.locationsTitle")}
          </h2>
          <p className="mt-2 text-lg text-ink-secondary">{t("home.locationsSubtitle")}</p>

          <ul className="mt-10 grid gap-6 md:grid-cols-3">
            {places.map((place) => (
              <li key={place.id} className="flex flex-col rounded-2xl bg-deep p-6 text-on-deep shadow-sm">
                <span className="flex h-12 w-16 items-center justify-center rounded-xl bg-white text-lg font-bold tracking-wider text-gray-900">
                  {place.airport_code}
                </span>
                <h3 className="mt-5 text-xl font-semibold">{place.name}</h3>
                <p className="mt-2 flex items-start gap-2 text-on-deep-muted">
                  <MapPin className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                  {place.address}
                </p>
                <a href="#top" className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold underline-offset-4 hover:underline">
                  {t("home.locationsBook")}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Call to action */}
      <section className="px-4 pb-16 sm:px-6 sm:pb-24" aria-labelledby="cta-title">
        <div className="relative isolate mx-auto flex max-w-7xl flex-col items-start gap-6 overflow-hidden rounded-3xl bg-deep px-8 py-14 text-white sm:px-14 sm:py-20 md:flex-row md:items-center md:justify-between">
          {ctaImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ctaImageUrl} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
          ) : (
            <Image src="/cta-banner.jpg" alt="" fill sizes="(min-width: 1280px) 1280px, 100vw" className="-z-20 object-cover object-[center_62%]" />
          )}
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/85 via-black/40 to-transparent" aria-hidden="true" />

          <div className="max-w-xl">
            <h2 id="cta-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("home.ctaTitle")}
            </h2>
            <p className="mt-3 text-lg text-white/85">{t("home.ctaBody")}</p>
          </div>

          <a
            href="#top"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            {t("home.ctaButton")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>
    </main>
  );
}
