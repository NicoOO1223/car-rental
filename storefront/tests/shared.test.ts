import { describe, expect, it } from "vitest";

import { storefrontCsp } from "@shared/csp";
import { isLanguage, negotiateLanguage } from "@shared/languages";
import { originOf, runtimeConfigScript, storefrontConfigFromEnv } from "@shared/runtimeConfig";

describe("negotiateLanguage", () => {
  it("takes the first language the visitor asks for that we have", () => {
    expect(negotiateLanguage("pl-PL,pl;q=0.9,en;q=0.8")).toBe("pl");
    expect(negotiateLanguage("de,it;q=0.7")).toBe("it");
  });

  it("respects the order of preference, not the order written", () => {
    expect(negotiateLanguage("en;q=0.4,it;q=0.9")).toBe("it");
  });

  it("falls back when nothing matches or nothing is sent", () => {
    expect(negotiateLanguage("de,fr")).toBe("en");
    expect(negotiateLanguage(null)).toBe("en");
    expect(negotiateLanguage("", "it")).toBe("it");
  });

  it("ignores languages the visitor refuses", () => {
    expect(negotiateLanguage("pl;q=0,it")).toBe("it");
  });
});

describe("isLanguage", () => {
  it("knows exactly the supported languages", () => {
    expect(["en", "it", "pl"].every(isLanguage)).toBe(true);
    expect(isLanguage("de")).toBe(false);
    expect(isLanguage("")).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe("runtime configuration", () => {
  it("reads every stack setting from the environment", () => {
    expect(
      storefrontConfigFromEnv({
        API_URL: "https://api.example.io",
        STRIPE_PUBLISHABLE_KEY: "pk_test_1",
        TURNSTILE_SITE_KEY: "0x4AAA",
        SENTRY_DSN: "https://k@o1.ingest.sentry.io/1",
        STOREFRONT_URL: "https://book.example.io",
      }),
    ).toEqual({
      apiUrl: "https://api.example.io",
      stripePublishableKey: "pk_test_1",
      turnstileSiteKey: "0x4AAA",
      sentryDsn: "https://k@o1.ingest.sentry.io/1",
      storefrontUrl: "https://book.example.io",
    });
  });

  it("defaults to a local API and empty keys", () => {
    const config = storefrontConfigFromEnv({});

    expect(config.apiUrl).toBe("http://127.0.0.1:8000");
    expect(config.stripePublishableKey).toBe("");
  });

  it("cannot be used to close the script tag", () => {
    const script = runtimeConfigScript({ ...storefrontConfigFromEnv({}), storefrontUrl: "</script><b>" });

    expect(script).not.toContain("</script>");
    expect(script.startsWith("window.__RUNTIME_CONFIG__=")).toBe(true);
  });

  it("finds the origin of an address", () => {
    expect(originOf("https://a.example.io/path?q=1")).toBe("https://a.example.io");
    expect(originOf("")).toBeNull();
    expect(originOf("not an address")).toBeNull();
  });
});

describe("storefrontCsp", () => {
  const config = storefrontConfigFromEnv({ API_URL: "https://api.example.io", SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" });

  it("lets the page talk to its API, Stripe and Turnstile, and nothing else", () => {
    const policy = storefrontCsp(config, false);

    expect(policy).toContain("connect-src 'self' https://api.example.io https://o1.ingest.sentry.io https://api.stripe.com");
    expect(policy).toContain("script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com");
    expect(policy).toContain("frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it("allows eval only in development", () => {
    expect(storefrontCsp(config, true)).toContain("'unsafe-eval'");
    expect(storefrontCsp(config, false)).not.toContain("'unsafe-eval'");
  });
});
