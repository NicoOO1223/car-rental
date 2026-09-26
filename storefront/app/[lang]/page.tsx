import { getPublicConfig } from "@/lib/publicApi";
import { getTranslator } from "@/lib/i18n";

export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);
  const config = await getPublicConfig();

  // The API cannot be reached, or the admin has not switched online booking on.
  if (!config || !config.storefront_enabled) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
        {config && <p className="text-sm font-medium text-ink-muted">{config.business_name}</p>}

        <h1 className="mt-2 text-3xl font-bold">{config ? t("unavailable.title") : t("unreachable.title")}</h1>

        <p className="mt-3 text-ink-secondary">{config ? t("unavailable.body") : t("unreachable.body")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold">{config.business_name}</h1>

      <p className="mt-3 text-ink-secondary">{t("home.comingSoon")}</p>
    </main>
  );
}
