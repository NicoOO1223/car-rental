import { brand } from "@/content/brand";

// Reads the deployment's settings for the demo form, when a request arrives (the
// routes are dynamic, so nothing here is frozen into the build).
//
//   FORM_SECRET             signs the form token; set it on every real deployment
//   TURNSTILE_SITE_KEY      shown to the browser
//   TURNSTILE_SECRET_KEY    checks the response on the server
//   DEMO_NOTIFY_ADDRESS     who is told about a request (default: the brand's contact address)
//   ACS_CONNECTION_STRING, MAIL_FROM_ADDRESS   Azure Communication Services (see lib/mailer.ts)
//
// Two flags exist for automated tests of the built site and must never be set on a
// real deployment: ALLOW_NO_TURNSTILE=1 and ALLOW_FILE_MAILER=1 (+ MAIL_OUTBOX_FILE).

type Env = Record<string, string | undefined>;

const isProduction = (env: Env) => env.NODE_ENV === "production";

/** The key for form tokens, or null when the timing check must be skipped (production without FORM_SECRET). */
export function formSecret(env: Env = process.env): string | null {
  if (env.FORM_SECRET) return env.FORM_SECRET;

  return isProduction(env) ? null : "development-only-form-secret";
}

export function turnstileConfig(env: Env = process.env): { siteKey: string | null; secret: string | null; allowNone: boolean } {
  const secret = env.TURNSTILE_SECRET_KEY || null;

  return {
    siteKey: env.TURNSTILE_SITE_KEY || null,
    secret,
    // Without a secret the check cannot run: fine on a developer's machine, refused in production unless a test says otherwise.
    allowNone: !secret && (!isProduction(env) || env.ALLOW_NO_TURNSTILE === "1"),
  };
}

export function notifyAddress(env: Env = process.env): string {
  return env.DEMO_NOTIFY_ADDRESS || brand.contactEmail;
}
