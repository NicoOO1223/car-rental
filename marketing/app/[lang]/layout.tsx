import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bricolage_Grotesque, Geist } from "next/font/google";

import { isLanguage } from "@shared/languages";

import "../globals.css";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { StickyCta } from "@/components/StickyCta";
import { brand } from "@/content/brand";
import { getTranslator } from "@/lib/i18n";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata, siteStructuredData } from "@/lib/seo";
import { enabledLanguages } from "@/lib/site";

// Latin only while English is the only language: the Latin-extended subset (Italian and Polish
// accents) doubles the font download for letters nobody sees. Add "latin-ext" with it/pl.
const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
// Headlines only.
const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin"] });

export function generateStaticParams() {
  return enabledLanguages().map((lang) => ({ lang }));
}

export const dynamicParams = false;

// The default for any page that does not state its own (the home page and the 404).
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = getTranslator(lang);

  return pageMetadata({ language: lang, path: "/", title: t("meta.homeTitle", { brand: brand.name }), description: t("meta.homeDescription") });
}

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  if (!isLanguage(lang)) notFound();

  const t = getTranslator(lang);

  return (
    <html lang={lang} className={`${geist.variable} ${display.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-accent-ink"
        >
          {t("nav.skip")}
        </a>
        <SiteHeader language={lang} />
        <div id="main" className="flex-1">
          {children}
        </div>
        <SiteFooter language={lang} />
        <StickyCta label={t("nav.cta")} />
        <JsonLd data={siteStructuredData(lang)} />
      </body>
    </html>
  );
}
