import { serverRuntimeConfig } from "@/lib/runtimeConfig";

function originOf(value: string | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * The Content-Security-Policy for one request. Built from this stack's own
 * runtime values (its API and error-tracking addresses), which is why it is
 * set per request in proxy.ts instead of once at build time.
 *
 * Report-Only first: the browser reports what the policy WOULD block without
 * breaking anything. The reports go to /api/csp-report, which writes them to the
 * container log (see cspHeaderName and docs/CSP.md for reading them). Fix
 * anything legitimate, then set CSP_ENFORCE=true on the stack to enforce it.
 *
 * 'unsafe-inline' for scripts is the price of static (non-nonce) CSP with
 * the App Router, which inlines its bootstrap scripts. img-src allows any
 * https host because staff paste car image URLs from arbitrary sites, and
 * data: because signatures are stored as data URIs.
 */
export function contentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV !== "production";
  const config = serverRuntimeConfig();
  const sentryOrigin = originOf(config.sentryDsn);

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    // Not the API: the browser only talks to this app's own server
    // (app/api/backend), which is what keeps the session token out of scripts.
    `connect-src 'self' ${[sentryOrigin, "https://api.stripe.com"].filter(Boolean).join(" ")}`,
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

/**
 * Which header carries the policy: enforcing when the stack says so
 * (CSP_ENFORCE=true), otherwise report-only. A per-stack setting, so a stack can
 * be switched once its reports have been clean, and switched back at once if
 * something legitimate turns out to be blocked.
 */
export function cspHeaderName(): string {
  return process.env.CSP_ENFORCE === "true"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}
