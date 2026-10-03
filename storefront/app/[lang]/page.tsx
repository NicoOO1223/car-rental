import Link from "next/link";

import { SearchForm } from "@/components/SearchForm";
import { getTranslator } from "@/lib/i18n";
import { getLocations, getPublicConfig } from "@/lib/publicApi";
import { runtimeConfig } from "@/lib/runtime";

export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);
  const [config, locations] = await Promise.all([getPublicConfig(), getLocations()]);

  // The API cannot be reached, or the admin has not switched online booking on.
  if (!config || !config.storefront_enabled) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-4 py-16">
        <h1 className="text-3xl font-bold">{config ? t("unavailable.title") : t("unreachable.title")}</h1>

        <p className="mt-3 text-ink-secondary">{config ? t("unavailable.body") : t("unreachable.body")}</p>
      </main>
    );
  }

  const heroImageUrl = config.has_hero_image
    ? `${runtimeConfig().apiUrl}/api/branding/landing-hero?v=${config.hero_image_version ?? 0}`
    : null;

  // Written once by the business, in their own language — never run
  // through this catalog, unlike every surrounding label.
  const headline = config.landing_headline || t("home.title");
  const tagline = config.landing_tagline || t("home.subtitle");

  const benefits = [
    { title: config.landing_benefit1_title, body: config.landing_benefit1_body },
    { title: config.landing_benefit2_title, body: config.landing_benefit2_body },
    { title: config.landing_benefit3_title, body: config.landing_benefit3_body },
  ].filter((benefit) => benefit.title.trim() || benefit.body.trim());

  return (
    <main>
      {/* Hero */}
      <div className="border-b border-border-subtle bg-surface">
        <div className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-10 sm:py-14 lg:grid-cols-[1fr_26rem]">
          <div>
            <h1 className="text-3xl font-bold sm:text-4xl">{headline}</h1>
            <p className="mt-3 text-lg text-ink-secondary">{tagline}</p>

            <ul className="mt-8 space-y-5">
              <li>
                <p className="font-semibold">{t("home.point1Title")}</p>
                <p className="text-ink-secondary">{t("home.point1Body", { percent: config.online_share_percent })}</p>
              </li>
              <li>
                <p className="font-semibold">{t("home.point2Title")}</p>
                <p className="text-ink-secondary">{t("home.point2Body", { hours: config.free_cancellation_hours })}</p>
              </li>
              <li>
                <p className="font-semibold">{t("home.point3Title")}</p>
                <p className="text-ink-secondary">{t("home.point3Body")}</p>
              </li>
            </ul>

            <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Link href={`/${lang}/fleet`} className="font-medium underline">
                {t("home.browseFleet")}
              </Link>
              <Link href={`/${lang}/manage`} className="font-medium underline">
                {t("home.manageBooking")}
              </Link>
            </p>
          </div>

          <div className="space-y-4">
            {/* The business's own photo, or a plain silhouette — never a
                blank box while nothing has been uploaded yet. */}
            <div className="aspect-[4/3] overflow-hidden rounded-xl bg-canvas">
              {heroImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={heroImageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <svg viewBox="0 0 200 100" className="h-full w-full p-6" role="presentation" aria-hidden="true">
                  <path
                    d="M34 68 L38 52 Q40 44 50 43 L96 41 Q106 41 113 47 L134 61 L160 64 Q168 65 168 70 L168 68 Z"
                    className="fill-gray-300"
                  />
                  <circle cx={62} cy={70} r={11} className="fill-gray-400" />
                  <circle cx={142} cy={70} r={11} className="fill-gray-400" />
                  <rect x={12} y={84} width={176} height={2} rx={1} className="fill-gray-200" />
                </svg>
              )}
            </div>

            <SearchForm language={lang} locations={locations ?? []} minLeadHours={config.min_booking_lead_hours} />
          </div>
        </div>
      </div>

      {/* Why book with us — only shown once the business has written it. */}
      {benefits.length > 0 && (
        <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
          <div className="grid gap-6 sm:grid-cols-3">
            {benefits.map((benefit, index) => (
              <div key={index} className="rounded-xl border border-border-subtle bg-surface p-5">
                {benefit.title && <p className="font-semibold">{benefit.title}</p>}
                {benefit.body && <p className="mt-1.5 text-sm text-ink-secondary">{benefit.body}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
