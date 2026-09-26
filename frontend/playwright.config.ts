import { defineConfig } from "@playwright/test";

// End-to-end tests drive a real browser against a running stack (the API on a
// scratch database, and the built frontend). Where they run is given by the
// environment, so the same tests run locally and in CI:
//   E2E_BASE_URL   the frontend, default http://localhost:3020
//   E2E_EMAIL / E2E_PASSWORD   an administrator on that stack
//   E2E_CHROME=1   use the Chrome installed on this machine instead of
//                  Playwright's own download (handy locally)
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3020",
    channel: process.env.E2E_CHROME ? "chrome" : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1360, height: 1000 },
  },
});
