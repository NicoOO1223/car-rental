import path from "node:path";
import type { NextConfig } from "next";

// The app imports ../shared, so the build's root is the repository, not this
// folder. That also puts the standalone server at .next/standalone/storefront/.
const repoRoot = path.join(__dirname, "..");

// The Content-Security-Policy is set per request in proxy.ts, since it names
// this stack's own API. These do not vary by stack.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
