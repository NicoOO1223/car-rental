import type { Metadata } from "next";

import { brand, isPlaceholderEmail, isTodo } from "@/content/brand";
import { CURRENCY, PRICES_CONFIRMED, plans, shownPrice } from "@/content/plans";
import { FAQ_COUNT } from "@/components/Faq";
import { getTranslator } from "@/lib/i18n";
import { href } from "@/lib/links";
import { isIndexable, siteUrl } from "@/lib/site";

// What search engines and link previews are told about each page: titles,
// canonical addresses, social cards and structured data. Nothing here may claim
// more than the page does: no ratings, no reviews, and a price only once prices
// are confirmed.

/** Used when SITE_URL is not set (a local run): relative addresses still need a base to resolve against. */
export const FALLBACK_SITE = "http://localhost:3000";

export function metadataBase(): URL {
  return new URL(siteUrl() ?? FALLBACK_SITE);
}

export type PageMeta = {
  language: string;
  /** The path without a language prefix, e.g. "/demo". */
  path: string;
  title: string;
  description: string;
  /** Pages that must never be indexed, whatever the site-wide setting (the thank-you page). */
  neverIndex?: boolean;
};

/** The complete metadata for a page: Next merges these keys shallowly, so each page states all of them. */
export function pageMetadata({ language, path, title, description, neverIndex = false }: PageMeta): Metadata {
  const indexable = isIndexable() && !neverIndex;
  const url = href(language, path);

  return {
    metadataBase: metadataBase(),
    title,
    description,
    alternates: { canonical: url },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", siteName: brand.name, title, description, url, locale: language === "en" ? "en_GB" : language },
    twitter: { card: "summary_large_image", title, description },
  };
}

// ---------------------------------------------------------------- structured data

type Json = Record<string, unknown>;

const absolute = (path: string): string | undefined => {
  const site = siteUrl();

  return site ? `${site}${path === "/" ? "" : path}` : undefined;
};

/** The organisation and the site. Details that are still placeholders are left out, never invented. */
export function siteStructuredData(language: string): Json[] {
  const url = absolute(href(language, "/"));
  const organization: Json = { "@context": "https://schema.org", "@type": "Organization", name: brand.name };

  if (url) organization.url = url;
  if (!isTodo(brand.legal.entity)) organization.legalName = brand.legal.entity;
  if (!isPlaceholderEmail(brand.contactEmail)) {
    organization.contactPoint = { "@type": "ContactPoint", contactType: "sales", email: brand.contactEmail };
  }

  const site: Json = { "@context": "https://schema.org", "@type": "WebSite", name: brand.name, inLanguage: language };

  if (url) site.url = url;

  return [organization, site];
}

/**
 * The product. `offers` appear only when prices are confirmed, and there is never
 * a rating or a review: we have no customers to have given one.
 */
export function softwareStructuredData(language: string): Json {
  const t = getTranslator(language);
  const data: Json = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: brand.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: t("meta.homeDescription"),
  };

  if (PRICES_CONFIRMED) {
    data.offers = plans.map((plan) => {
      const price = shownPrice(plan);

      return {
        "@type": "Offer",
        name: t(`pricing.${plan.id}`),
        price: price ?? undefined,
        priceCurrency: CURRENCY,
        description: plan.vehicles === null ? t("pricing.unlimited") : t("pricing.upTo", { count: plan.vehicles }),
      };
    });
  }

  return data;
}

/** The FAQ, from the same messages as the accordion, so the two cannot drift apart. */
export function faqStructuredData(language: string): Json {
  const t = getTranslator(language);

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: Array.from({ length: FAQ_COUNT }, (_, index) => index + 1).map((n) => ({
      "@type": "Question",
      name: t(`faq.q${n}`),
      acceptedAnswer: { "@type": "Answer", text: t(`faq.a${n}`) },
    })),
  };
}

// A backslash, "u", and the code of "<": spelled out so no tool in between can read it as an escape.
const ESCAPED_LESS_THAN = String.fromCharCode(92, 117, 48, 48, 51, 99);

/** JSON for a <script type="application/ld+json">: "<" is escaped so the data can never close the tag. */
export function jsonLdString(data: Json | Json[]): string {
  return JSON.stringify(data).replace(/</g, ESCAPED_LESS_THAN);
}
