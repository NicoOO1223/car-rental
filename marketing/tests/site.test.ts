import { afterEach, describe, expect, it, vi } from "vitest";

import { brand, missingLegalFields } from "@/content/brand";
import { href } from "@/lib/links";
import { isIndexable, siteUrl } from "@/lib/site";

afterEach(() => vi.unstubAllEnvs());

describe("indexing", () => {
  it("is never allowed while the brand is a placeholder, whatever the environment says", () => {
    vi.stubEnv("SITE_INDEXABLE", "true");

    expect(brand.placeholder).toBe(true);
    expect(isIndexable()).toBe(false);
  });

  it("is off by default", () => {
    vi.stubEnv("SITE_INDEXABLE", "");

    expect(isIndexable()).toBe(false);
  });
});

describe("site address", () => {
  it("drops trailing slashes", () => {
    vi.stubEnv("SITE_URL", "https://example.test//");

    expect(siteUrl()).toBe("https://example.test");
  });

  it("is unknown when not set", () => {
    vi.stubEnv("SITE_URL", "");

    expect(siteUrl()).toBeUndefined();
  });
});

describe("links", () => {
  it("leaves English unprefixed and prefixes other languages", () => {
    expect(href("en", "/")).toBe("/");
    expect(href("en", "/demo")).toBe("/demo");
    expect(href("it", "/")).toBe("/it");
    expect(href("it", "/demo")).toBe("/it/demo");
  });
});

describe("legal details", () => {
  it("lists every field still waiting for the owner", () => {
    expect(missingLegalFields()).toEqual(["legal.entity", "legal.address", "legal.vatId", "legal.country"]);
  });
});

describe("contact address", () => {
  it("is a placeholder on a reserved example domain until the owner decides", async () => {
    const { isPlaceholderEmail } = await import("@/content/brand");

    expect(isPlaceholderEmail(brand.contactEmail)).toBe(true);
    expect(isPlaceholderEmail("hello@example.com")).toBe(true);
    expect(isPlaceholderEmail("TODO")).toBe(true);
    expect(isPlaceholderEmail("owner@real-company.eu")).toBe(false);
  });
});
