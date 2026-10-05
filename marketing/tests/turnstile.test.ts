import { describe, expect, it, vi } from "vitest";

import { formSecret, notifyAddress, turnstileConfig } from "@/lib/demoConfig";
import { verifyTurnstile } from "@/lib/turnstile";

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe("Turnstile verification", () => {
  it("passes when Cloudflare says success", async () => {
    const fetchImpl = reply({ success: true });

    expect(await verifyTurnstile({ token: "t", ip: "1.2.3.4", secret: "s", fetchImpl })).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: URLSearchParams }];

    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.body.get("secret")).toBe("s");
    expect(init.body.get("response")).toBe("t");
    expect(init.body.get("remoteip")).toBe("1.2.3.4");
  });

  it("does not send an unknown address", async () => {
    const fetchImpl = reply({ success: true });

    await verifyTurnstile({ token: "t", ip: "unknown", secret: "s", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: URLSearchParams }];

    expect(init.body.has("remoteip")).toBe(false);
  });

  it("fails when Cloudflare says no", async () => {
    expect(await verifyTurnstile({ token: "t", ip: "1.2.3.4", secret: "s", fetchImpl: reply({ success: false }) })).toBe(false);
  });

  it("fails without a token, without calling Cloudflare", async () => {
    const fetchImpl = reply({ success: true });

    expect(await verifyTurnstile({ token: "", ip: "1.2.3.4", secret: "s", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails on an error response, a network error or a timeout: any failure is a no", async () => {
    expect(await verifyTurnstile({ token: "t", ip: "i", secret: "s", fetchImpl: reply({ success: true }, false) })).toBe(false);
    expect(await verifyTurnstile({ token: "t", ip: "i", secret: "s", fetchImpl: vi.fn(async () => Promise.reject(new Error("offline"))) })).toBe(false);
    expect(await verifyTurnstile({ token: "t", ip: "i", secret: "s", fetchImpl: reply({}) })).toBe(false);
  });

  it("does not treat a truthy but non-true success as a pass", async () => {
    expect(await verifyTurnstile({ token: "t", ip: "i", secret: "s", fetchImpl: reply({ success: "true" }) })).toBe(false);
  });
});

describe("deployment settings", () => {
  it("refuses to run without a human check in production, unless a test says so", () => {
    expect(turnstileConfig({ NODE_ENV: "production" }).allowNone).toBe(false);
    expect(turnstileConfig({ NODE_ENV: "production", ALLOW_NO_TURNSTILE: "1" }).allowNone).toBe(true);
  });

  it("allows no human check on a developer's machine", () => {
    expect(turnstileConfig({ NODE_ENV: "development" }).allowNone).toBe(true);
  });

  it("never skips the check when a secret is set, whatever the flag says", () => {
    expect(turnstileConfig({ NODE_ENV: "production", TURNSTILE_SECRET_KEY: "s", ALLOW_NO_TURNSTILE: "1" }).allowNone).toBe(false);
  });

  it("only has a form secret in production when one is configured", () => {
    expect(formSecret({ NODE_ENV: "production" })).toBeNull();
    expect(formSecret({ NODE_ENV: "production", FORM_SECRET: "x" })).toBe("x");
    expect(formSecret({ NODE_ENV: "development" })).toBeTruthy();
  });

  it("tells the placeholder contact address unless one is configured", () => {
    expect(notifyAddress({})).toBe("hello@example.com");
    expect(notifyAddress({ DEMO_NOTIFY_ADDRESS: "owner@real.eu" })).toBe("owner@real.eu");
  });
});
