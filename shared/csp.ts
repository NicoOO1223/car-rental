import { originOf, type StorefrontRuntimeConfig } from "./runtimeConfig";

/**
 * The Content-Security-Policy for the public storefront, built per request from
 * this stack's own addresses.
 *
 * The storefront talks to its API, Stripe (payment form and its frames) and
 * Cloudflare Turnstile (the challenge widget and its frame), and nothing else.
 * 'unsafe-inline' for scripts is the price of static (non-nonce) policies with
 * the App Router, which inlines its bootstrap scripts.
 *
 * Violations are reported to /api/csp-report, which writes them to the
 * container log. Report-only until a stack sets CSP_ENFORCE=true (see
 * storefrontCspHeader), once its reports have been clean.
 */
export function storefrontCsp(config: StorefrontRuntimeConfig, isDev: boolean): string {
  const connect = [originOf(config.apiUrl), originOf(config.sentryDsn), "https://api.stripe.com"].filter(Boolean);

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    // Car photos come from arbitrary https hosts the staff paste in.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${connect.join(" ")}`,
    "frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

/** The header that carries the policy: enforcing when the stack says so, otherwise report-only. */
export function storefrontCspHeader(enforce: boolean): string {
  return enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

/**
 * The Content-Security-Policy for the marketing site. It is a static page set with
 * one form, so the policy is tight: its own files, and Cloudflare Turnstile (the
 * challenge widget, its frame and its calls) on the demo form. No API, no Stripe,
 * no third-party images or fonts (the fonts are self-hosted at build time).
 * 'unsafe-inline' for scripts is the price of a static (non-nonce) policy with the
 * App Router, which inlines its bootstrap scripts; a nonce would make every page
 * dynamic.
 *
 * Violations go to /api/csp-report (the container log). Report-only until a
 * deployment sets CSP_ENFORCE=true, once its reports have been clean.
 */
export function marketingCsp(isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

/** The header that carries the marketing policy: enforcing when the deployment says so, otherwise report-only. */
export function marketingCspHeader(enforce: boolean): string {
  return enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}
