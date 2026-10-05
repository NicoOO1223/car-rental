import { getTranslator } from "@/lib/i18n";

// The skeleton of a legal page: a banner, a date line and numbered headings.
// The wording under each heading is the lawyer's job, so each section says so.
export function LegalPage({ language, kind, sections }: { language: string; kind: "privacy" | "terms"; sections: number }) {
  const t = getTranslator(language);
  const items = Array.from({ length: sections }, (_, index) => `legal.${kind}.s${index + 1}`);

  return (
    <main className="mx-auto max-w-170 px-4 py-16 md:py-24">
      <p role="note" className="rounded-lg border border-border-strong bg-surface-sunken p-4 text-base">
        {t("legal.draftBanner")}
      </p>
      <h1 className="display mt-8 text-5xl font-bold">{t(`legal.${kind}.title`)}</h1>
      <p className="mt-2 text-ink-muted">{t("legal.updated")}</p>

      {items.map((key, index) => (
        <section key={key} className="mt-10">
          <h2 className="display text-2xl font-bold">
            {index + 1}. {t(key)}
          </h2>
          <p className="mt-2 text-ink-secondary">{t("legal.pending")}</p>
        </section>
      ))}
    </main>
  );
}
