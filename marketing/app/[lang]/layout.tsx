import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";

import { isLanguage } from "@shared/languages";

import "../globals.css";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { StickyCta } from "@/components/StickyCta";
import { brand } from "@/content/brand";
import { getTranslator } from "@/lib/i18n";
import { enabledLanguages, isIndexable, siteUrl } from "@/lib/site";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin", "latin-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Headlines only. Latin-ext carries the Italian and Polish accented letters.
const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin", "latin-ext"] });

export function generateStaticParams() {
  return enabledLanguages().map((lang) => ({ lang }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = getTranslator(lang);
  const site = siteUrl();

  return {
    metadataBase: site ? new URL(site) : undefined,
    title: t("meta.homeTitle", { brand: brand.name }),
    description: t("meta.homeDescription"),
    robots: isIndexable() ? { index: true, follow: true } : { index: false, follow: false },
  };
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
    <html lang={lang} className={`${geist.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}>
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
      </body>
    </html>
  );
}
