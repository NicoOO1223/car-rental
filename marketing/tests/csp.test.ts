import { describe, expect, it } from "vitest";

import { marketingCsp, marketingCspHeader } from "@shared/csp";

import { allowReport, MAX_REPORT_BYTES, summarizeCspReport } from "@/lib/cspReport";

const directives = (policy: string) => Object.fromEntries(policy.split("; ").map((part) => [part.split(" ")[0], part.split(" ").slice(1)]));

describe("the marketing Content-Security-Policy", () => {
  const policy = directives(marketingCsp(false));

  it("allows only the site itself, plus Cloudflare for the bot check", () => {
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["script-src"]).toContain("https://challenges.cloudflare.com");
    expect(policy["frame-src"]).toEqual(["https://challenges.cloudflare.com"]);
    expect(policy["img-src"]).toEqual(["'self'", "data:"]);
    expect(policy["font-src"]).toEqual(["'self'"]);
  });

  it("allows no payment provider, no API and no third-party images or fonts", () => {
    expect(marketingCsp(false)).not.toMatch(/stripe|https:\s|https:;|googleapis|gstatic|\*/i);
  });

  it("forbids plugins, framing, a changed base address and posting elsewhere", () => {
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
    expect(policy["form-action"]).toEqual(["'self'"]);
  });

  it("reports violations to the site's own endpoint", () => {
    expect(policy["report-uri"]).toEqual(["/api/csp-report"]);
  });

  it("allows eval only in development, where the framework needs it", () => {
    expect(marketingCsp(false)).not.toContain("unsafe-eval");
    expect(marketingCsp(true)).toContain("'unsafe-eval'");
  });

  it("is report-only unless enforcement is switched on", () => {
    expect(marketingCspHeader(false)).toBe("Content-Security-Policy-Report-Only");
    expect(marketingCspHeader(true)).toBe("Content-Security-Policy");
  });
});

describe("CSP violation reports", () => {
  it("are boiled down to a safe line: no query string or fragment survives", () => {
    const summary = summarizeCspReport({
      "csp-report": {
        "document-uri": "https://site.example/demo?token=secret#frag",
        "blocked-uri": "https://evil.example/x.js?k=1",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        disposition: "report",
        "line-number": 12,
        extra: "ignored",
      },
    });

    expect(summary).toEqual({
      "document-uri": "https://site.example/demo",
      "blocked-uri": "https://evil.example/x.js",
      "violated-directive": "script-src-elem",
      "effective-directive": "script-src-elem",
      disposition: "report",
      "line-number": 12,
    });
  });

  it("ignore anything that is not a violation report", () => {
    expect(summarizeCspReport(null)).toBeNull();
    expect(summarizeCspReport({})).toBeNull();
    expect(summarizeCspReport({ "csp-report": "text" })).toBeNull();
    expect(summarizeCspReport({ "csp-report": { "document-uri": "https://site.example/" } })).toBeNull();
  });

  it("are limited in size and in how many reach the log", () => {
    expect(MAX_REPORT_BYTES).toBe(16 * 1024);

    const start = 10_000_000;
    const allowed = Array.from({ length: 100 }, () => allowReport(start)).filter(Boolean).length;

    expect(allowed).toBe(60);
    expect(allowReport(start + 61_000)).toBe(true);
  });
});
