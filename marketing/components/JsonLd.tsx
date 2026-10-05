import { jsonLdString } from "@/lib/seo";

/** Structured data for search engines, as a script that is data, not code (so the CSP does not touch it). */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
