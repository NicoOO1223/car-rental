import Link from "next/link";

import { SearchForm } from "@/components/SearchForm";
import { getTranslator } from "@/lib/i18n";
import { getLocations, getPublicConfig } from "@/lib/publicApi";

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

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_26rem]">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">{t("home.title")}</h1>
          <p className="mt-3 text-lg text-ink-secondary">{t("home.subtitle")}</p>

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

        <SearchForm language={lang} locations={locations ?? []} minLeadHours={config.min_booking_lead_hours} />
      </div>
    </main>
  );
}
