import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";

import { LANGUAGES, isLanguage } from "@shared/languages";
import { runtimeConfigScript } from "@shared/runtimeConfig";

import "../globals.css";

import { Providers } from "@/components/Providers";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getMessages, getTranslator } from "@/lib/i18n";
import { getAccount } from "@/lib/accountServer";
import { getLocations, getPublicConfig } from "@/lib/publicApi";
import { runtimeConfig } from "@/lib/runtime";

// Latin-ext carries the Polish and Italian accented letters.
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin", "latin-ext"] });

export function generateStaticParams() {
  return LANGUAGES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = getTranslator(lang);
  const config = await getPublicConfig();
  const site = runtimeConfig().storefrontUrl;

  return {
    metadataBase: site ? new URL(site) : undefined,
    title: config?.business_name ? t("meta.title", { name: config.business_name }) : t("meta.titleNeutral"),
    description: t("meta.description"),
    // Every language is an alternate of the same page.
    alternates: {
      languages: Object.fromEntries(LANGUAGES.map((language) => [language, `/${language}`])),
    },
  };
}

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  // Render per request: this stack addresses come from the container
  // environment and must never be frozen into a page built beforehand.
  await connection();

  const { lang } = await params;

  if (!isLanguage(lang)) notFound();

  const [config, locations, account] = await Promise.all([getPublicConfig(), getLocations(), getAccount()]);

  return (
    <html lang={lang} className={`${jakarta.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigScript(runtimeConfig()) }} />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers language={lang} messages={getMessages(lang)}>
          <SiteHeader language={lang} config={config} account={account} />
          <div className="flex-1">{children}</div>
          <SiteFooter language={lang} config={config} locations={locations ?? []} signedIn={account !== null} />
        </Providers>
      </body>
    </html>
  );
}
