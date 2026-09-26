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
 * Report-Only first: the browser logs what the policy WOULD block without
 * breaking anything. Read the console on the live site for a while, fix
 * anything legitimate, then switch the header to Content-Security-Policy.
 *
 * 'unsafe-inline' for scripts is the price of static (non-nonce) CSP with
 * the App Router, which inlines its bootstrap scripts. img-src allows any
 * https host because staff paste car image URLs from arbitrary sites, and
 * data: because signatures are stored as data URIs.
 */
export function contentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV !== "production";
  const config = serverRuntimeConfig();
  const apiOrigin = originOf(config.apiUrl);
  const sentryOrigin = originOf(config.sentryDsn);

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' ${[apiOrigin, sentryOrigin, "https://api.stripe.com"]
      .filter(Boolean)
      .join(" ")}`,
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
