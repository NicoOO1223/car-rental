import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// The Content-Security-Policy is set per request in proxy.ts, since it names
// this stack's own API. These do not vary by stack.
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
