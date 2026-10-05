import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { LANGUAGES } from "@shared/languages";

import { getFleet, getPublicConfig } from "@/lib/publicApi";
import { runtimeConfig } from "@/lib/runtime";

// The pages worth finding: the home page, the cars and the two legal texts, in
// every language, each pointing at its translations. Empty while online booking
// is off, so a closed site is not advertised.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();

  const site = runtimeConfig().storefrontUrl;
  const config = await getPublicConfig();

  if (!site || !config?.storefront_enabled) return [];

  const classes = ((await getFleet()) ?? []).flatMap((vehicle) => (vehicle.class_slug ? [`/fleet/${vehicle.class_slug}`] : []));
  const pages = ["", "/fleet", ...classes, "/terms", "/privacy"];

  return pages.flatMap((page) =>
    LANGUAGES.map((language) => ({
      url: `${site}/${language}${page}`,
      alternates: { languages: Object.fromEntries(LANGUAGES.map((other) => [other, `${site}/${other}${page}`])) },
    })),
  );
}
