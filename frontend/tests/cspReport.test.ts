import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as receive } from "@/app/api/csp-report/route";
import { allowReport, summarizeCspReport } from "@/lib/cspReport";
import { contentSecurityPolicy, cspHeaderName } from "@/lib/csp";

const report = (overrides: Record<string, unknown> = {}) => ({
  "csp-report": {
    "document-uri": "https://staff.example.com/cars?token=secret#frag",
    "blocked-uri": "https://evil.example.net/x.js?key=1",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    disposition: "report",
    "line-number": 12,
    ...overrides,
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("summarising a violation report", () => {
  it("keeps what is needed to find the cause and drops queries and fragments", () => {
    expect(summarizeCspReport(report())).toEqual({
      "document-uri": "https://staff.example.com/cars",
      "blocked-uri": "https://evil.example.net/x.js",
      "violated-directive": "script-src-elem",
      "effective-directive": "script-src-elem",
      disposition: "report",
      "line-number": 12,
    });
  });

  it("ignores anything that is not a violation report", () => {
    for (const body of [null, "text", 5, {}, { "csp-report": null }, { "csp-report": {} }, report({ "violated-directive": 3, "effective-directive": undefined })]) {
      expect(summarizeCspReport(body)).toBeNull();
    }
  });

  it("does not let a report write a long line into the log", () => {
    const summary = summarizeCspReport(report({ "blocked-uri": "https://x/" + "a".repeat(5000) }));

    expect(String(summary?.["blocked-uri"]).length).toBeLessThanOrEqual(200);
  });
});

describe("limiting what reaches the log", () => {
  it("lets a burst through up to the limit, then none until the minute is up", () => {
    const results = Array.from({ length: 70 }, () => allowReport(1_000_000));

    expect(results.filter(Boolean)).toHaveLength(60);
    expect(allowReport(1_000_000 + 61_000)).toBe(true);
  });
});

describe("the report address", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    receive(new Request("http://localhost/api/csp-report", { method: "POST", body, headers }));

  it("logs a violation and always answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Date, "now").mockReturnValue(5_000_000_000);

    const response = await post(JSON.stringify(report()), { "content-type": "application/csp-report" });

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^csp-violation \{.*script-src-elem/);
    expect(String(warn.mock.calls[0][0])).not.toContain("secret");
  });

  it("answers 204 and logs nothing for junk or an oversized body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await post("not json")).status).toBe(204);
    expect((await post(JSON.stringify(report()), { "content-length": "999999" })).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("which header carries the policy", () => {
  it("is report-only unless the stack says to enforce", () => {
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");

    vi.stubEnv("CSP_ENFORCE", "true");
    expect(cspHeaderName()).toBe("Content-Security-Policy");

    vi.stubEnv("CSP_ENFORCE", "yes");
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
  });

  it("sends violations to the report address, and does not let the browser reach the API directly", () => {
    vi.stubEnv("API_URL", "https://api.acme.example");

    const policy = contentSecurityPolicy();

    expect(policy).toContain("report-uri /api/csp-report");
    expect(policy).not.toContain("api.acme.example");
  });
});
