import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone server, which the Docker
  // build copies into a slim runtime image instead of shipping node_modules.
  output: "standalone",
};

export default nextConfig;
