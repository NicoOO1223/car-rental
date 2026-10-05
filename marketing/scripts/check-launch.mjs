// Runs the launch gate (tests/launch.test.ts) with LAUNCH_GATE=1, on any
// operating system. It fails until the brand, legal details, prices and the
// unconfirmed copy have all been settled.

import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["vitest", "run", "tests/launch.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, LAUNCH_GATE: "1" },
});

process.exit(result.status ?? 1);
