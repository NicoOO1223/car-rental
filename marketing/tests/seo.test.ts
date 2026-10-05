import { afterEach, describe, expect, it, vi } from "vitest";

import { FAQ_COUNT } from "@/components/Faq";
import { PRICES_CONFIRMED } from "@/content/plans";
import { faqStructuredData, jsonLdString, pageMetadata, siteStructuredData, softwareStructuredData } from "@/lib/seo";

import { messages } from "./helpers";

afterEach(() => vi.unstubAllEnvs());

const META = { language: "en", path: "/demo", title: "Request a demo | Velto", description: "A walkthrough." };

describe("page metadata", () => {
  it("gives every page a canonical address, social card and robots rule of its own", () => {
    const meta = pageMetadata(META);

    expect(meta.alternates?.canonical).toBe("/demo");
    expect(meta.openGraph).toMatchObject({ type: "website", title: META.title, description: META.description, url: "/demo" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: META.title });
  });

  it("uses the unprefixed address for English and a prefix for other languages", () => {
    expect(pageMetadata({ ...META, path: "/" }).alternates?.canonical).toBe("/");
    expect(pageMetadata({ ...META, language: "it", path: "/" }).alternates?.canonical).toBe("/it");
  });

  it("is noindex while the brand is a placeholder, even when the build says index", () => {
    vi.stubEnv("SITE_INDEXABLE", "true");

    expect(pageMetadata(META).robots).toEqual({ index: false, follow: false });
  });

  it("is noindex for a page that must never be indexed", () => {
    expect(pageMetadata({ ...META, neverIndex: true }).robots).toEqual({ index: false, follow: false });
  });
});

describe("structured data", () => {
  const everything = () => JSON.stringify([...siteStructuredData("en"), softwareStructuredData("en"), faqStructuredData("en")]);

  it("never claims a rating or a review: there are no customers to have given one", () => {
    expect(everything()).not.toMatch(/aggregateRating|"review"|ratingValue|reviewCount/);
  });

  it("describes the product as business software", () => {
    expect(softwareStructuredData("en")).toMatchObject({ "@type": "SoftwareApplication", applicationCategory: "BusinessApplication", operatingSystem: "Web" });
  });

  it("offers a price only once prices are confirmed", () => {
    if (!PRICES_CONFIRMED) expect(softwareStructuredData("en")).not.toHaveProperty("offers");
  });

  it("builds the FAQ from the same ten questions as the accordion", () => {
    const faq = faqStructuredData("en") as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };

    expect(faq.mainEntity).toHaveLength(FAQ_COUNT);

    faq.mainEntity.forEach((entry, index) => {
      expect(entry.name).toBe(messages[`faq.q${index + 1}`]);
      expect(entry.acceptedAnswer.text).toBe(messages[`faq.a${index + 1}`]);
    });
  });

  it("leaves out contact and legal details that are still placeholders instead of inventing them", () => {
    const organization = siteStructuredData("en")[0];

    expect(organization).not.toHaveProperty("contactPoint");
    expect(organization).not.toHaveProperty("legalName");
  });

  it("includes the address of the site only when it is known", () => {
    vi.stubEnv("SITE_URL", "");

    expect(siteStructuredData("en")[0]).not.toHaveProperty("url");

    vi.stubEnv("SITE_URL", "https://example.test");

    expect(siteStructuredData("en")[0]).toMatchObject({ url: "https://example.test" });
  });
});

describe("JSON for a script tag", () => {
  it("can never close the tag it sits in", () => {
    const hostile = { name: "</script><script>alert(1)</script>", html: "<!-- <b> -->" };
    const text = jsonLdString(hostile);

    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual(hostile);
  });
});
