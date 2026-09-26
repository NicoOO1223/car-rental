import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Geist } from "next/font/google";

import { LANGUAGES, isLanguage } from "@shared/languages";
import { runtimeConfigScript } from "@shared/runtimeConfig";

import "../globals.css";

import { getPublicConfig } from "@/lib/publicApi";
import { getTranslator } from "@/lib/i18n";
import { runtimeConfig } from "@/lib/runtime";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export function generateStaticParams() {
  return LANGUAGES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = getTranslator(lang);
  const config = await getPublicConfig();

  return {
    title: config?.business_name ? t("meta.title", { name: config.business_name }) : t("meta.titleNeutral"),
    description: t("meta.description"),
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

  return (
    <html lang={lang} className={`${geistSans.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigScript(runtimeConfig()) }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
