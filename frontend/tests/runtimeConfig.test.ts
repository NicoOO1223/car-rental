import { afterEach, describe, expect, it } from "vitest";

import { runtimeConfigScript, serverRuntimeConfig } from "@/lib/runtimeConfig";

const KEYS = ["API_URL", "NEXT_PUBLIC_API_URL", "STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("runtime configuration", () => {
  it("reads the stack's own values from the environment", () => {
    process.env.API_URL = "https://api.acme.example";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_acme";

    expect(serverRuntimeConfig()).toEqual({
      apiUrl: "https://api.acme.example",
      stripePublishableKey: "pk_acme",
      sentryDsn: "",
    });
  });

  it("prefers the runtime names but still honours the local-development ones", () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";
    expect(serverRuntimeConfig().apiUrl).toBe("http://localhost:8000");

    process.env.API_URL = "https://api.acme.example";
    expect(serverRuntimeConfig().apiUrl).toBe("https://api.acme.example");
  });

  it("falls back to the local backend when nothing is set", () => {
    expect(serverRuntimeConfig().apiUrl).toBe("http://127.0.0.1:8000");
  });

  it("cannot be broken out of its script tag by a value", () => {
    const script = runtimeConfigScript({ apiUrl: "</script><script>alert(1)", stripePublishableKey: "", sentryDsn: "" });

    expect(script).not.toContain("</script>");
    expect(script.startsWith("window.__RUNTIME_CONFIG__=")).toBe(true);
  });
});
