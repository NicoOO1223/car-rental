import { originOf, type StorefrontRuntimeConfig } from "./runtimeConfig";

/**
 * The Content-Security-Policy for the public storefront, built per request from
 * this stack's own addresses.
 *
 * The storefront talks to its API, Stripe (payment form and its frames) and
 * Cloudflare Turnstile (the challenge widget and its frame), and nothing else.
 * 'unsafe-inline' for scripts is the price of static (non-nonce) policies with
 * the App Router, which inlines its bootstrap scripts.
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
  ].join("; ");
}
