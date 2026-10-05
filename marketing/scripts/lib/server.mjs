// Shared by the browser scripts (smoke, lighthouse): start the BUILT site on a spare
// port and wait until it answers. Run `npm run build` first.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function freePort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Starts `next start` with `extraEnv` on `port`. Returns { child, log(), stop() }. */
export async function startSite(port, extraEnv = {}) {
  const env = { ...process.env, NODE_ENV: "production", PORT: String(port), ...extraEnv };

  for (const name of ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "ACS_CONNECTION_STRING"]) {
    if (!(name in extraEnv)) delete env[name];
  }

  const child = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`http://localhost:${port}/health`)).ok) return { child, log: () => output, stop: () => child.kill() };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  child.kill();
  throw new Error(`the site did not start:\n${output}`);
}
