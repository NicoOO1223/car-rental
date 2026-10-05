import type { MetadataRoute } from "next";

import { isIndexable, siteUrl } from "@/lib/site";

const PATHS = ["/", "/demo", "/privacy", "/terms"];

// Empty unless the site is indexable and its address is known: a sitemap of
// relative or placeholder URLs would only mislead a crawler.
export default function sitemap(): MetadataRoute.Sitemap {
  const site = siteUrl();

  if (!isIndexable() || !site) return [];

  return PATHS.map((path) => ({ url: `${site}${path === "/" ? "" : path}` }));
}
