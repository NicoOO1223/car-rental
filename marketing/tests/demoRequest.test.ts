import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_BODY_BYTES, MIN_FILL_MS, processDemoRequest, type DemoRequestDeps, type DemoRequestInput } from "@/lib/demoRequest";
import { createFormToken } from "@/lib/formToken";
import { getTranslator } from "@/lib/i18n";
import type { MailMessage, Mailer } from "@/lib/mailer";
import { RateLimiter } from "@/lib/rateLimit";

const NOW = 1_800_000_000_000;
const SECRET = "test-secret";
const HOST = "site.example.test";

const valid = { name: "Ada Lovelace", company: "Isola Rent", email: "ada@example.com", country: "IT", fleet: "11-30", message: "Two airports." };

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  failOn: number[] = [];
  private calls = 0;

  async send(message: MailMessage) {
    this.calls++;

    if (this.failOn.includes(this.calls)) throw new Error("the email service is down");

    this.sent.push(message);
  }
}

let mailer: FakeMailer;
let logs: string[];
let deps: DemoRequestDeps;

function request(body: unknown, overrides: Partial<DemoRequestInput> = {}, age = 8000): DemoRequestInput {
  const payload = typeof body === "string" ? body : JSON.stringify({ token: createFormToken(NOW - age, SECRET), turnstileToken: "ok", ...(body as object) });

  return { contentType: "application/json", bodyText: payload, origin: `https://${HOST}`, host: HOST, ip: "203.0.113.9", ...overrides };
}

beforeEach(() => {
  mailer = new FakeMailer();
  logs = [];
  deps = {
    now: () => NOW,
    limiter: new RateLimiter(),
    mailer,
    verifyHuman: vi.fn(async (token: string) => token === "ok"),
    allowNoTurnstile: false,
    formSecret: SECRET,
    notifyAddress: "owner@example.com",
    brandName: "Velto",
    t: getTranslator("en"),
    log: (message) => logs.push(message),
  };
});

describe("a valid request", () => {
  it("emails the owner, then acknowledges the visitor", async () => {
    const result = await processDemoRequest(request(valid), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(mailer.sent).toHaveLength(2);

    const [owner, reply] = mailer.sent;

    expect(owner.to).toBe("owner@example.com");
    expect(owner.subject).toBe("Demo request: Isola Rent (11-30 vehicles)");
    expect(owner.replyTo).toBe("ada@example.com");
    expect(owner.text).toContain("Ada Lovelace");
    expect(owner.text).toContain("Italy (IT)");
    expect(owner.text).toContain("Two airports.");

    expect(reply.to).toBe("ada@example.com");
    expect(reply.subject).toBe("We received your demo request");
    expect(reply.text).toContain("Hello Ada Lovelace");
    expect(reply.text).toContain("Velto");
    expect(reply.replyTo).toBe("owner@example.com");
  });

  it("logs the acceptance without the visitor's address or name", async () => {
    await processDemoRequest(request(valid), deps);

    const line = logs.find((entry) => entry.includes("accepted"));

    expect(line).toBeTruthy();
    expect(line).not.toContain("ada@example.com");
    expect(line).not.toContain("Ada");
    expect(line).not.toContain("Isola");
  });

  it("accepts a form that was open for exactly the minimum time", async () => {
    expect((await processDemoRequest(request(valid, {}, MIN_FILL_MS), deps)).status).toBe(200);
    expect(mailer.sent).toHaveLength(2);
  });
});

describe("spam and abuse", () => {
  it("answers a filled honeypot with success and sends nothing", async () => {
    const result = await processDemoRequest(request({ ...valid, website: "http://spam.example" }), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(mailer.sent).toHaveLength(0);
    expect(deps.verifyHuman).not.toHaveBeenCalled();
  });

  it("answers a form posted too fast with success and sends nothing", async () => {
    const result = await processDemoRequest(request(valid, {}, MIN_FILL_MS - 1), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(mailer.sent).toHaveLength(0);
  });

  it("refuses a missing, altered or expired form token", async () => {
    const forged = JSON.stringify({ ...valid, token: `${NOW - 60_000}.0000`, turnstileToken: "ok" });
    const missing = JSON.stringify({ ...valid, turnstileToken: "ok" });
    const old = request(valid, {}, 3 * 60 * 60 * 1000);

    for (const input of [request(forged), request(missing), old]) {
      const result = await processDemoRequest(input, deps);

      expect(result.status).toBe(403);
      expect(result.body).toEqual({ error: "session_expired" });
    }

    expect(mailer.sent).toHaveLength(0);
  });

  it("skips only the timing check when no form secret is configured", async () => {
    deps.formSecret = null;

    const result = await processDemoRequest(request(JSON.stringify({ ...valid, turnstileToken: "ok" })), deps);

    expect(result.status).toBe(200);
    expect(mailer.sent).toHaveLength(2);
  });

  it("refuses when the human check fails, without sending", async () => {
    const result = await processDemoRequest(request({ ...valid, turnstileToken: "bad" }), deps);

    expect(result).toEqual({ status: 403, body: { error: "human_check_failed" } });
    expect(mailer.sent).toHaveLength(0);
  });

  it("refuses to run with no human check at all in production", async () => {
    deps.verifyHuman = null;
    deps.allowNoTurnstile = false;

    expect((await processDemoRequest(request(valid), deps)).status).toBe(503);
    expect(mailer.sent).toHaveLength(0);
  });

  it("can run with no human check when explicitly allowed (tests, development)", async () => {
    deps.verifyHuman = null;
    deps.allowNoTurnstile = true;

    expect((await processDemoRequest(request(valid), deps)).status).toBe(200);
  });

  it("limits each address to five requests in ten minutes, valid or not", async () => {
    for (let i = 0; i < 5; i++) await processDemoRequest(request({ name: "" }), deps);

    const sixth = await processDemoRequest(request(valid), deps);

    expect(sixth.status).toBe(429);
    expect(sixth.status === 429 && sixth.body.retryAfter).toBeGreaterThan(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it("does not let one address use up another's budget", async () => {
    for (let i = 0; i < 5; i++) await processDemoRequest(request(valid), deps);

    expect((await processDemoRequest(request(valid, { ip: "198.51.100.7" }), deps)).status).toBe(200);
  });

  it("refuses a request from another site", async () => {
    for (const origin of ["https://evil.example", "http://site.example.test.evil.example", "not a url", null]) {
      const result = await processDemoRequest(request(valid, { origin }), deps);

      expect(result, String(origin)).toEqual({ status: 403, body: { error: "bad_origin" } });
    }

    expect(mailer.sent).toHaveLength(0);
  });

  it("refuses a body that is not JSON, too large or not a JSON object", async () => {
    expect((await processDemoRequest(request(valid, { contentType: "text/plain" }), deps)).status).toBe(415);
    expect((await processDemoRequest(request(valid, { contentType: null }), deps)).status).toBe(415);
    expect((await processDemoRequest(request("x".repeat(MAX_BODY_BYTES + 1)), deps)).status).toBe(413);
    expect((await processDemoRequest(request("{not json"), deps)).status).toBe(400);
    expect((await processDemoRequest(request("[1,2]"), deps)).status).toBe(400);
    expect((await processDemoRequest(request("null"), deps)).status).toBe(400);
  });
});

describe("invalid fields", () => {
  it("reports the code of each bad field and sends nothing", async () => {
    const result = await processDemoRequest(request({ ...valid, name: "", email: "nope", fleet: "999" }), deps);

    expect(result).toEqual({ status: 400, body: { error: "invalid", errors: { name: "required", email: "invalid_email", fleet: "invalid_choice" } } });
    expect(mailer.sent).toHaveLength(0);
    expect(deps.verifyHuman).not.toHaveBeenCalled();
  });

  it("refuses header injection through the name, company or email", async () => {
    for (const field of ["name", "company", "email"] as const) {
      const result = await processDemoRequest(request({ ...valid, [field]: "x\r\nBcc: victim@example.com" }), deps);

      expect(result.status, field).toBe(400);
    }

    expect(mailer.sent).toHaveLength(0);
  });
});

describe("when email fails", () => {
  it("tells the visitor and sends no acknowledgement if the owner cannot be told", async () => {
    mailer.failOn = [1];

    const result = await processDemoRequest(request(valid), deps);

    expect(result).toEqual({ status: 502, body: { error: "send_failed" } });
    expect(mailer.sent).toHaveLength(0);
    expect(logs.some((line) => line.includes("owner mail not sent"))).toBe(true);
  });

  it("still succeeds if only the acknowledgement fails: the owner has the request", async () => {
    mailer.failOn = [2];

    const result = await processDemoRequest(request(valid), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(mailer.sent).toHaveLength(1);
    expect(logs.some((line) => line.includes("auto-reply not sent"))).toBe(true);
  });

  it("refuses when no mailer is configured", async () => {
    deps.mailer = null;

    expect((await processDemoRequest(request(valid), deps)).status).toBe(503);
  });
});

describe("the owner's email", () => {
  it("escapes everything the visitor typed in the HTML part", async () => {
    await processDemoRequest(
      request({ ...valid, name: "<b>Ada</b>", company: "A & B <script>alert(1)</script>", message: "<img src=x onerror=alert(1)>\n\"quoted\" and 'single'" }),
      deps,
    );

    const html = mailer.sent[0].html ?? "";

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Ada");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("&quot;quoted&quot;");
    expect(html).toContain("&#39;single&#39;");
  });

  it("says when there is no message", async () => {
    await processDemoRequest(request({ ...valid, message: "" }), deps);

    expect(mailer.sent[0].text).toContain("(no message)");
  });

  it("escapes the visitor's name in the acknowledgement as well", async () => {
    await processDemoRequest(request({ ...valid, name: "<i>Ada</i>" }), deps);

    expect(mailer.sent[1].html).not.toContain("<i>Ada");
    expect(mailer.sent[1].html).toContain("&lt;i&gt;Ada");
  });
});
