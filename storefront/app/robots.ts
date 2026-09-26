import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { runtimeConfig } from "@/lib/runtime";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();

  const site = runtimeConfig().storefrontUrl;

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Steps of a booking and a renter own booking are not for search engines.
      disallow: ["/*/book", "/*/booking", "/*/manage"],
    },
    sitemap: site ? `${site}/sitemap.xml` : undefined,
  };
}
