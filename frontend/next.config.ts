import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone server, which the Docker
  // build copies into a slim runtime image instead of shipping node_modules.
  output: "standalone",
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
