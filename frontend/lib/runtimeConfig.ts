/**
 * Settings that differ between stacks (a customer's own API address, Stripe
 * key and error-tracking address), read when the app runs rather than
 * baked in when it is built, so one image serves every stack.
 *
 * On the server they come from the container's environment (API_URL,
 * STRIPE_PUBLISHABLE_KEY, SENTRY_DSN); the layout writes them into the page
 * as window.__RUNTIME_CONFIG__ for the browser. The old NEXT_PUBLIC_* names
 * still work as a fallback, which keeps local development unchanged.
 */

export type RuntimeConfig = {
  apiUrl: string;
  stripePublishableKey: string;
  sentryDsn: string;
};

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

const DEFAULT_API_URL = "http://127.0.0.1:8000";

/** From the environment. Only meaningful on the server. */
export function serverRuntimeConfig(): RuntimeConfig {
  return {
    apiUrl: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL,
    stripePublishableKey:
      process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
    sentryDsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || "",
  };
}

/** The values for this stack, on the server or in the browser. */
export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") return serverRuntimeConfig();

  return (
    window.__RUNTIME_CONFIG__ ?? {
      // Reached only if the layout's script did not run.
      apiUrl: process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL,
      stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
      sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN || "",
    }
  );
}

/** The script text that hands the server's values to the browser. */
export function runtimeConfigScript(config: RuntimeConfig): string {
  // "<" is escaped so a value can never close the script tag.
  return `window.__RUNTIME_CONFIG__=${JSON.stringify(config).replace(/</g, "\\u003c")};`;
}
