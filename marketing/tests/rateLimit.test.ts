import { describe, expect, it } from "vitest";

import { clientIp } from "@/lib/clientIp";
import { DEMO_WINDOWS, RateLimiter } from "@/lib/rateLimit";

const MINUTE = 60_000;
const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

describe("rate limiter", () => {
  it("allows the first five requests in ten minutes and refuses the sixth", () => {
    const limiter = new RateLimiter();

    for (let i = 0; i < 5; i++) expect(limiter.check("1.2.3.4", DEMO_WINDOWS, i * 1000)).toBeNull();

    expect(limiter.check("1.2.3.4", DEMO_WINDOWS, 6000)).not.toBeNull();
  });

  it("tells how long to wait, counted from the oldest request in the window", () => {
    const limiter = new RateLimiter();

    for (let i = 0; i < 5; i++) limiter.check("a", DEMO_WINDOWS, 0);

    expect(limiter.check("a", DEMO_WINDOWS, 4 * MINUTE)).toBe(6 * 60);
  });

  it("allows requests again once the window has passed", () => {
    const limiter = new RateLimiter();

    for (let i = 0; i < 5; i++) limiter.check("a", DEMO_WINDOWS, 0);

    expect(limiter.check("a", DEMO_WINDOWS, 10 * MINUTE + 1)).toBeNull();
  });

  it("does not count a refused request, so waiting always works", () => {
    const limiter = new RateLimiter();

    for (let i = 0; i < 5; i++) limiter.check("a", DEMO_WINDOWS, 0);
    for (let i = 0; i < 20; i++) expect(limiter.check("a", DEMO_WINDOWS, 5 * MINUTE)).not.toBeNull();

    expect(limiter.check("a", DEMO_WINDOWS, 10 * MINUTE + 1)).toBeNull();
  });

  it("keeps a separate budget for each address", () => {
    const limiter = new RateLimiter();

    for (let i = 0; i < 5; i++) limiter.check("a", DEMO_WINDOWS, 0);

    expect(limiter.check("a", DEMO_WINDOWS, 1)).not.toBeNull();
    expect(limiter.check("b", DEMO_WINDOWS, 1)).toBeNull();
  });

  it("also enforces the daily limit of twenty", () => {
    const limiter = new RateLimiter();
    let now = 0;
    let allowed = 0;

    // Four a "session" (under the ten-minute limit), twenty minutes apart: the day's twenty run out in the sixth.
    for (let session = 0; session < 10; session++) {
      for (let i = 0; i < 4; i++) if (limiter.check("a", DEMO_WINDOWS, now + i) === null) allowed++;

      now += 20 * MINUTE;
    }

    expect(allowed).toBe(20);
    expect(limiter.check("a", DEMO_WINDOWS, now)).not.toBeNull();
    expect(limiter.check("a", DEMO_WINDOWS, 24 * 60 * MINUTE + 1)).toBeNull();
  });

  it("can be reset", () => {
    const limiter = new RateLimiter();

    for (let i = 0; i < 5; i++) limiter.check("a", DEMO_WINDOWS, 0);
    limiter.reset();

    expect(limiter.check("a", DEMO_WINDOWS, 1)).toBeNull();
  });
});

describe("client address", () => {
  it("trusts the last forwarded address: the earlier ones are what the client claimed", () => {
    expect(clientIp(headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then to unknown", () => {
    expect(clientIp(headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(headers({}))).toBe("unknown");
  });

  it("ignores empty entries", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.9, , " }))).toBe("203.0.113.9");
  });
});
