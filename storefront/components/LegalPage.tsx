import { notFound } from "next/navigation";

import { getTranslator } from "@/lib/i18n";
import { getLegal, getPublicConfig } from "@/lib/publicApi";

/** The business terms or privacy text, as it wrote them (plain text), and a link to a longer version if it gave one. */
export async function LegalPage({ language, kind }: { language: string; kind: "terms" | "privacy" }) {
  const t = getTranslator(language);
  const [config, legal] = await Promise.all([getPublicConfig(), getLegal()]);

  if (!config?.storefront_enabled) notFound();

  const text = kind === "terms" ? legal?.terms_text : legal?.privacy_text;
  const url = kind === "terms" ? legal?.terms_url : legal?.privacy_url;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{kind === "terms" ? t("legal.termsTitle") : t("legal.privacyTitle")}</h1>

      {legal && <p className="mt-1 text-sm text-ink-muted">{t("legal.version", { version: legal.legal_version })}</p>}

      {text?.trim() ? (
        // Written by the business as plain text: kept as written, never read as markup.
        <div className="mt-6 whitespace-pre-wrap text-ink-secondary">{text}</div>
      ) : (
        !url && <p className="mt-6 text-ink-secondary">{t("legal.empty")}</p>
      )}

      {url && (
        <p className="mt-6">
          <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
            {t("legal.openLink")}
          </a>
        </p>
      )}
    </main>
  );
}
