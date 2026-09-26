// Settings that differ between stacks, read when a server starts rather than
// baked into its image, so one image serves every stack.

export type StorefrontRuntimeConfig = {
  /** This stack's backend, e.g. https://car-rental-backend.example.io */
  apiUrl: string;
  stripePublishableKey: string;
  /** Cloudflare Turnstile's public site key. Empty turns the check off in development. */
  turnstileSiteKey: string;
  sentryDsn: string;
  /** This site's own public address, for links and metadata. */
  storefrontUrl: string;
};

const DEFAULT_API_URL = "http://127.0.0.1:8000";

type Env = Record<string, string | undefined>;

/** From the environment. Only meaningful on the server. */
export function storefrontConfigFromEnv(env: Env): StorefrontRuntimeConfig {
  return {
    apiUrl: env.API_URL || DEFAULT_API_URL,
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || "",
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
    sentryDsn: env.SENTRY_DSN || "",
    storefrontUrl: env.STOREFRONT_URL || "",
  };
}

/** The script text that hands the server's values to the browser. */
export function runtimeConfigScript(config: StorefrontRuntimeConfig): string {
  // "<" is escaped so a value can never close the script tag.
  return `window.__RUNTIME_CONFIG__=${JSON.stringify(config).replace(/</g, "\\u003c")};`;
}

/** The origin of an address, or null when it is empty or not an address. */
export function originOf(value: string | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
