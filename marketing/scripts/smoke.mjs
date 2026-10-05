// A browser smoke test of the BUILT site (run `npm run build` first), on a desktop
// and on a phone viewport. It starts its own server on a spare port with test-only
// settings, so no real email is sent and no bot check is needed:
//
//   ALLOW_FILE_MAILER=1 + MAIL_OUTBOX_FILE   mail is written to a file we can read
//   ALLOW_NO_TURNSTILE=1                     there is no Cloudflare to ask
//
// Those two flags exist for this script only and must never be set on a real
// deployment (lib/demoConfig.ts, lib/mailer.ts).
//
//   node scripts/smoke.mjs [--only desktop|phone]
//
// It checks: the page and its navigation, the 404, the form's errors and success
// (also by keyboard alone), the bot defences, a failing server, the security
// headers, that no third-party request is made, and accessibility with axe.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "..", "frontend", "package.json"));
const { chromium } = require("@playwright/test");
const { AxeBuilder } = await import("@axe-core/playwright");

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const PROJECTS = [
  { name: "desktop", context: { viewport: { width: 1440, height: 900 } } },
  { name: "phone", context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
].filter((p) => !only || p.name === only);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : `  (${detail})`}`);
};

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(name, false, String(error.message).split("\n")[0]);
  }
}

// ---------------------------------------------------------------- the server

async function startServer(port, outbox) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    FORM_SECRET: "smoke-test-secret",
    DEMO_NOTIFY_ADDRESS: "owner@example.com",
    ALLOW_NO_TURNSTILE: "1",
    ALLOW_FILE_MAILER: "1",
    MAIL_OUTBOX_FILE: outbox,
  };
  delete env.TURNSTILE_SITE_KEY;
  delete env.TURNSTILE_SECRET_KEY;
  delete env.ACS_CONNECTION_STRING;

  const child = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/health`);
      if (r.ok) return { child, log: () => log };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  child.kill();
  throw new Error(`the server did not start:\n${log}`);
}

const mailLines = (outbox) => (existsSync(outbox) ? readFileSync(outbox, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

async function freePort() {
  const { createServer } = await import("node:net");

  return new Promise((resolve) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------- one project

async function run(browser, project) {
  console.log(`\n${project.name}`);

  const dir = mkdtempSync(join(tmpdir(), "marketing-smoke-"));
  const outbox = join(dir, "outbox.jsonl");
  writeFileSync(outbox, "");
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const server = await startServer(port, outbox);

  try {
    const context = await browser.newContext(project.context);
    const page = await context.newPage();
    const external = new Set();
    const consoleErrors = [];

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !url.protocol.startsWith("data") && url.protocol !== "blob:") external.add(url.origin);
    });
    page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
    page.on("pageerror", (error) => consoleErrors.push(String(error)));

    // ---- the home page
    await step("home", async () => {
      const response = await page.goto(base, { waitUntil: "networkidle" });
      check("home answers 200", response.status() === 200);
      check("home has one h1 with the promise", (await page.locator("h1").count()) === 1 && /Run the counter/.test(await page.locator("h1").innerText()));
      check("no horizontal scroll", (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
      check("every image has alt text and a size", await page.evaluate(() => [...document.images].every((i) => i.alt.length > 3 && i.width > 0 && i.getAttribute("width"))));
      check("home is noindex while the brand is a placeholder", /noindex/.test(await page.locator('meta[name="robots"]').getAttribute("content")));
    });

    await step("navigation", async () => {
      if (project.name === "phone") {
        await page.getByRole("button", { name: "Menu" }).click();
        check("the phone menu opens", await page.locator("#mobile-menu").isVisible());
        await page.getByRole("link", { name: "Pricing" }).first().click();
        check("a menu link closes the menu", (await page.locator("#mobile-menu").count()) === 0);
      } else {
        await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).click();
      }

      await page.waitForTimeout(300);
      check("the pricing section shows three plans", (await page.locator("#pricing ul > li").count()) >= 3);
      check("no price is shown while prices are unconfirmed", (await page.locator("#pricing").getByText("Ask for a quote", { exact: true }).count()) === 3 && !/€\s?\d/.test(await page.locator("#pricing").innerText()));

      const first = page.locator("#faq details").first();
      await first.locator("summary").click();
      check("a FAQ item collapses and opens", !(await first.evaluate((d) => d.open)));
      check("there are ten FAQ items", (await page.locator("#faq details").count()) === 10);
    });

    // ---- 404
    await step("404", async () => {
      const response = await page.goto(`${base}/nope`);
      check("an unknown page is a 404", response.status() === 404);
      check("the 404 page offers a way home", await page.getByRole("link", { name: "Go to home" }).isVisible());
    });

    // ---- the form
    await step("form errors", async () => {
      await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Send request" }).click();
      const summary = page.locator('[role="alert"][tabindex="-1"]');
      await summary.waitFor();
      check("an empty form shows an error summary", await summary.isVisible());
      check("focus moves to the summary", await summary.evaluate((el) => el === document.activeElement));
      check("each bad field is marked invalid", (await page.locator('[aria-invalid="true"]').count()) === 5);
      check("the errors use the agreed wording", /Enter your name\./.test(await summary.innerText()) && /Choose a range\./.test(await summary.innerText()));

      await page.getByLabel("Your name").fill("Ada Lovelace");
      await page.getByLabel("Company").fill("Isola Rent");
      await page.getByLabel("Work email").fill("not-an-email");
      await page.getByLabel("Country").selectOption("IT");
      await page.getByLabel("Fleet size").selectOption("11-30");
      await page.getByRole("button", { name: "Send request" }).click();
      check("a bad email is reported on its own", (await page.locator('[aria-invalid="true"]').count()) === 1 && /valid email/.test(await page.locator('[role="alert"][tabindex="-1"]').innerText()));
      check("nothing was sent for invalid input", mailLines(outbox).length === 0);
    });

    await step("form success", async () => {
      await page.getByLabel("Work email").fill("ada@example.com");
      await page.getByLabel(/Anything we should know/).fill("Two airports and a van.");
      await page.waitForTimeout(3200); // a person takes longer than the three-second floor
      await page.getByRole("button", { name: "Send request" }).click();
      await page.waitForURL(`${base}/demo/thanks`);
      check("success goes to the thank-you page", true);
      check("the page names the visitor and the address", /Thanks, Ada\./.test(await page.locator("h1").innerText()) && /ada@example\.com/.test(await page.locator("main").innerText()));
      check("the thank-you page is noindex", /noindex/.test(await page.locator('meta[name="robots"]').getAttribute("content")));

      const mail = mailLines(outbox);
      check("two emails were sent", mail.length === 2, `got ${mail.length}`);
      check("the owner's email carries the request and replies to the visitor", mail[0]?.to === "owner@example.com" && mail[0]?.replyTo === "ada@example.com" && /Two airports and a van\./.test(mail[0]?.text ?? "") && /Isola Rent/.test(mail[0]?.subject ?? ""));
      check("the visitor's acknowledgement goes to them", mail[1]?.to === "ada@example.com" && /We received your demo request/.test(mail[1]?.subject ?? ""));
    });

    await step("thank-you page opened directly", async () => {
      const fresh = await context.newPage();
      await fresh.goto(`${base}/demo/thanks`, { waitUntil: "networkidle" });
      check("shows the generic wording without a submission", /Thanks for your request\./.test(await fresh.locator("h1").innerText()));
      await fresh.close();
    });

    await step("form by keyboard", async () => {
      await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
      await page.getByLabel("Your name").focus();
      const order = [];
      for (let i = 0; i < 7; i++) {
        order.push(await page.evaluate(() => document.activeElement?.getAttribute("name") ?? document.activeElement?.tagName));
        await page.keyboard.press("Tab");
      }
      check("tab order follows the page and skips the honeypot", order.join(",") === "name,company,email,country,fleet,message,BUTTON", order.join(","));

      await page.getByLabel("Your name").focus();
      await page.keyboard.type("Grace Hopper");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Fleet Co");
      await page.keyboard.press("Tab");
      await page.keyboard.type("grace@example.com");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Germany"); // a select picks by typing
      await page.keyboard.press("Tab");
      await page.keyboard.press("ArrowDown"); // first range
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.waitForTimeout(3200);
      await page.keyboard.press("Enter");
      await page.waitForURL(`${base}/demo/thanks`);
      const mail = mailLines(outbox);
      check("a keyboard-only submission is delivered", mail.length === 4 && mail[2]?.replyTo === "grace@example.com" && /DE/.test(mail[2]?.text ?? ""), `mails: ${mail.length}`);
    });

    await step("bot defences", async () => {
      // Too fast: told it worked, nothing sent.
      await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
      await page.getByLabel("Your name").fill("Quick Bot");
      await page.getByLabel("Company").fill("Bots Inc");
      await page.getByLabel("Work email").fill("bot@example.com");
      await page.getByLabel("Country").selectOption("IT");
      await page.getByLabel("Fleet size").selectOption("1-10");
      const before = mailLines(outbox).length;
      await page.getByRole("button", { name: "Send request" }).click();
      await page.waitForURL(`${base}/demo/thanks`);
      check("a form posted too fast is dropped silently", mailLines(outbox).length === before);

      // Honeypot: filled by a script, the page still says thanks, nothing sent.
      await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
      await page.getByLabel("Your name").fill("Honey Bot");
      await page.getByLabel("Company").fill("Pots Ltd");
      await page.getByLabel("Work email").fill("honey@example.com");
      await page.getByLabel("Country").selectOption("IT");
      await page.getByLabel("Fleet size").selectOption("1-10");
      await page.locator('input[name="website"]').fill("http://spam.example", { force: true });
      await page.waitForTimeout(3200);
      await page.getByRole("button", { name: "Send request" }).click();
      await page.waitForURL(`${base}/demo/thanks`);
      check("a filled honeypot is dropped silently", mailLines(outbox).length === before);

      const honeypot = await (async () => {
        await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
        const box = await page.locator('input[name="website"]').boundingBox();
        return box === null || box.x < 0 || box.width <= 2;
      })();
      check("the honeypot cannot be seen or reached", honeypot);
    });

    await step("server failure", async () => {
      await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
      await page.route("**/api/demo", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "send_failed" }) }));
      await page.getByLabel("Your name").fill("Retry Person");
      await page.getByLabel("Company").fill("Retry Co");
      await page.getByLabel("Work email").fill("retry@example.com");
      await page.getByLabel("Country").selectOption("IT");
      await page.getByLabel("Fleet size").selectOption("1-10");
      await page.getByRole("button", { name: "Send request" }).click();
      const alert = page.locator('[role="alert"][tabindex="-1"]');
      await alert.waitFor();
      const text = await alert.innerText();
      check("a failing server shows the email fallback with the address", /Your message was not sent/.test(text) && /hello@example\.com/.test(text), text);
      check("what the visitor typed is kept", (await page.getByLabel("Your name").inputValue()) === "Retry Person");
      check("the button works again", await page.getByRole("button", { name: "Send request" }).isEnabled());
      await page.unroute("**/api/demo");
    });

    // ---- the server's side
    await step("headers and routes", async () => {
      const home = await context.request.get(base);
      const headers = home.headers();
      check("security headers are set", headers["x-content-type-options"] === "nosniff" && headers["x-frame-options"] === "DENY" && !!headers["strict-transport-security"] && !!headers["referrer-policy"]);
      check("robots.txt disallows everything for now", /Disallow: \//.test(await (await context.request.get(`${base}/robots.txt`)).text()));
      check("the API refuses a GET", (await context.request.get(`${base}/api/demo`)).status() === 405);
      const session = await (await context.request.get(`${base}/api/demo/session`)).json();
      check("the session endpoint gives a signed token and no site key without Turnstile", /^\d+\.[0-9a-f]{32}$/.test(session.token) && session.siteKey === null);
      const cross = await context.request.post(`${base}/api/demo`, { headers: { "content-type": "application/json", origin: "https://evil.example" }, data: {} });
      check("a post from another origin is refused", cross.status() === 403);
      check("/en redirects to the canonical address", (await context.request.get(`${base}/en/demo`, { maxRedirects: 0 })).status() === 308);
    });

    check("no request left this site", external.size === 0, [...external].join(", "));
    // The 404 page and the mocked 502 are provoked on purpose, and the browser logs those as resource errors.
    const unexpected = consoleErrors.filter((e) => !/Failed to load resource: the server responded with a status of (404|502)/.test(e));
    check("no unexpected console errors", unexpected.length === 0, unexpected.slice(0, 2).join(" | "));

    // ---- accessibility
    for (const path of ["/", "/demo", "/demo/thanks", "/privacy", "/terms", "/nope"]) {
      await step(`axe ${path}`, async () => {
        await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        check(`${path} has no serious accessibility violations`, serious.length === 0, serious.map((v) => `${v.id} x${v.nodes.length}`).join(", "));
      });
    }

    await context.close();
  } finally {
    server.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

const browser = await chromium.launch();

try {
  for (const project of PROJECTS) await run(browser, project);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} failed` : ""}.`);
process.exit(failed.length ? 1 : 0);
