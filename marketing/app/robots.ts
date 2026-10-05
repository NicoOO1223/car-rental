import type { MetadataRoute } from "next";

import { isIndexable, siteUrl } from "@/lib/site";

// Decided when the site is built (see lib/site.ts), so it always agrees with
// the noindex tag on every page.
export default function robots(): MetadataRoute.Robots {
  const site = siteUrl();

  if (!isIndexable()) return { rules: { userAgent: "*", disallow: "/" } };

  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/demo/thanks"] },
    sitemap: site ? `${site}/sitemap.xml` : undefined,
  };
}
