import { createHash } from "node:crypto";

import { autoReply, ownerMessage } from "@/lib/demoEmails";
import { parseDemoRequest } from "@/lib/demoSchema";
import { formTokenAge } from "@/lib/formToken";
import type { Translator } from "@/lib/i18n";
import type { Mailer } from "@/lib/mailer";
import { DEMO_WINDOWS, type RateLimiter } from "@/lib/rateLimit";

// The whole decision flow of the demo request, with every outside thing passed
// in, so it can be tested without a network, a clock or a mail server. The route
// (app/api/demo/route.ts) only gathers these and turns the result into a response.

export const MAX_BODY_BYTES = 8 * 1024;
/** A form posted sooner than this after it opened was not filled in by a person. */
export const MIN_FILL_MS = 3000;

export type DemoRequestInput = {
  contentType: string | null;
  bodyText: string;
  /** The Origin header, if the browser sent one. */
  origin: string | null;
  /** The host the request was addressed to. */
  host: string | null;
  ip: string;
};

export type DemoRequestDeps = {
  now: () => number;
  limiter: RateLimiter;
  /** The mailer, or null when none is configured. */
  mailer: Mailer | null;
  /** Checks a Turnstile response. Null means "not configured": allowed only when `allowNoTurnstile`. */
  verifyHuman: ((token: string, ip: string) => Promise<boolean>) | null;
  allowNoTurnstile: boolean;
  /** Key for the form token; null skips the timing check. */
  formSecret: string | null;
  notifyAddress: string;
  brandName: string;
  t: Translator;
  log: (message: string) => void;
};

export type DemoRequestResult =
  | { status: 200; body: { ok: true } }
  | { status: 400; body: { error: "invalid" | "invalid_json"; errors?: Record<string, string> } }
  | { status: 403; body: { error: "bad_origin" | "human_check_failed" | "session_expired" } }
  | { status: 413 | 415; body: { error: "too_large" | "unsupported" } }
  | { status: 429; body: { error: "rate_limited"; retryAfter: number } }
  | { status: 502 | 503; body: { error: "send_failed" } };

const OK: DemoRequestResult = { status: 200, body: { ok: true } };

/** A short, non-reversible tag for logs, so a log line can be matched to a complaint without holding the address. */
function tag(value: string): string {
  return createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 8);
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export async function processDemoRequest(input: DemoRequestInput, deps: DemoRequestDeps): Promise<DemoRequestResult> {
  const { log } = deps;
  const now = deps.now();

  if (!input.contentType?.toLowerCase().includes("application/json")) return { status: 415, body: { error: "unsupported" } };

  if (Buffer.byteLength(input.bodyText, "utf8") > MAX_BODY_BYTES) return { status: 413, body: { error: "too_large" } };

  // Browsers always send Origin on a cross-site POST; one that does not match this host is not our form.
  if (!input.origin || !input.host || !sameHost(input.origin, input.host)) {
    log("demo-request rejected: bad origin");

    return { status: 403, body: { error: "bad_origin" } };
  }

  // Every request that gets this far counts, valid or not, so probing is limited too.
  const wait = deps.limiter.check(input.ip, DEMO_WINDOWS, now);

  if (wait !== null) {
    log("demo-request rejected: rate limited");

    return { status: 429, body: { error: "rate_limited", retryAfter: wait } };
  }

  let body: Record<string, unknown>;

  try {
    const parsed = JSON.parse(input.bodyText);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }

  // A bot fills every field it finds. It is told it worked and nothing is sent.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    log("demo-request dropped: honeypot");

    return OK;
  }

  const token = typeof body.token === "string" ? body.token : "";

  if (deps.formSecret) {
    const age = formTokenAge(token, deps.formSecret, now);

    if (age === null) return { status: 403, body: { error: "session_expired" } };

    if (age < MIN_FILL_MS) {
      log("demo-request dropped: too fast");

      return OK;
    }
  }

  const parsed = parseDemoRequest(body);

  if (!parsed.ok) return { status: 400, body: { error: "invalid", errors: parsed.errors } };

  if (deps.verifyHuman) {
    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";

    if (!(await deps.verifyHuman(turnstileToken, input.ip))) {
      log("demo-request rejected: human check failed");

      return { status: 403, body: { error: "human_check_failed" } };
    }
  } else if (!deps.allowNoTurnstile) {
    // Refuse rather than run with no bot check at all, like the storefront's backend does.
    log("demo-request refused: no human check is configured");

    return { status: 503, body: { error: "send_failed" } };
  }

  if (!deps.mailer) {
    log("demo-request refused: no mailer is configured");

    return { status: 503, body: { error: "send_failed" } };
  }

  const { data } = parsed;

  try {
    await deps.mailer.send(ownerMessage(data, deps.notifyAddress));
  } catch (error) {
    // Nothing reached the owner, so the visitor is told, and no acknowledgement goes out for a request nobody has.
    log(`demo-request failed: owner mail not sent (${error instanceof Error ? error.message : "unknown error"})`);

    return { status: 502, body: { error: "send_failed" } };
  }

  try {
    await deps.mailer.send(autoReply(data, deps.t, deps.brandName, deps.notifyAddress));
  } catch (error) {
    // The owner has the request; a missing acknowledgement is not worth failing the visitor for.
    log(`demo-request: auto-reply not sent (${error instanceof Error ? error.message : "unknown error"})`);
  }

  log(`demo-request accepted: email=${tag(data.email)} fleet=${data.fleet} country=${data.country}`);

  return OK;
}
