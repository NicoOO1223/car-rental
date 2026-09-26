import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const isDev = process.env.NODE_ENV !== "production";

// Origins the browser legitimately talks to. Both are baked in at build time
// like the other NEXT_PUBLIC_* values.
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL);
const sentryOrigin = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);

// Report-Only first: the browser logs what the policy WOULD block without
// breaking anything. Read the console on the live site for a while, fix
// anything legitimate, then rename the header to Content-Security-Policy.
//
// 'unsafe-inline' for scripts is the price of static (non-nonce) CSP with
// the App Router, which inlines its bootstrap scripts. img-src allows any
// https host because staff paste car image URLs from arbitrary sites, and
// data: because signatures are stored as data URIs.
const contentSecurityPolicy = [
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

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone server, which the Docker
  // build copies into a slim runtime image instead of shipping node_modules.
  output: "standalone",

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  // The check-in flow used to live under /reservations/finalize.
  async redirects() {
    return [
      {
        source: "/reservations/finalize",
        destination: "/handovers",
        permanent: true,
      },
      {
        source: "/reservations/finalize/:id",
        destination: "/handovers/:id/check-in",
        permanent: true,
      },
    ];
  },
};

// Only wrap with Sentry once a DSN is actually configured, so local/CI
// builds with no Sentry project set up yet behave exactly as before.
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      // Source map upload needs an auth token; skip it until one exists
      // rather than failing the build.
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
    })
  : nextConfig;
