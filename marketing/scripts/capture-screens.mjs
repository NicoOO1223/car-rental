// Captures the product screenshots for the marketing site from the isolated demo
// stack (marketing/scripts/demo-stack.ps1) and writes optimised WebP files to
// public/screens/, plus public/screens/manifest.json.
//
//   .\scripts\demo-stack.ps1 reseed      # a FRESH seed: shot "checkout" saves a condition
//   node scripts/capture-screens.mjs [--only dashboard,fleet] [--panel URL] [--storefront URL]
//
// (`npm run screens` does both.) Everything on screen comes from the fictional
// "Isola Rent" seed. Before a file is written, the page text is checked: every
// email must be @example.com, no real-looking plate or phone may appear, and
// nothing from scripts/real-values.local.txt (your own deny-list, gitignored: one
// real surname, email, phone number or plate per line) may be present.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Playwright is the one the staff app already depends on.
const require = createRequire(join(root, "..", "frontend", "package.json"));
const { chromium } = require("@playwright/test");
const sharp = (await import("sharp")).default;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const PANEL = option("panel", process.env.MARKETING_DEMO_PANEL_URL ?? "http://localhost:3010");
const STORE = option("storefront", process.env.MARKETING_DEMO_STOREFRONT_URL ?? "http://localhost:3012");
const only = option("only", "")?.split(",").filter(Boolean);
const manifestPath = join(here, "demo-manifest.json");

if (!existsSync(manifestPath)) {
  console.error("No demo-manifest.json: run `.\\scripts\\demo-stack.ps1 up` first.");
  process.exit(1);
}

const demo = JSON.parse(readFileSync(manifestPath, "utf8"));
const outDir = join(root, "public", "screens");
mkdirSync(outDir, { recursive: true });

const denyFile = join(here, "real-values.local.txt");
const deny = existsSync(denyFile)
  ? readFileSync(denyFile, "utf8").split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean)
  : [];

if (!deny.length) console.warn("! No scripts/real-values.local.txt: the deny-list check is skipped (the generic checks still run).");

// ---------------------------------------------------------------- the safety check

/** Throws if anything on the page could be real data. */
async function assertNoRealData(page, id) {
  const text = await page.evaluate(() => document.body.innerText);
  const problems = [];

  for (const email of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
    if (!email.toLowerCase().endsWith("@example.com")) problems.push(`email ${email}`);
  }

  for (const plate of text.match(/\b[A-Z]{2}[ -]?\d{3}[ -]?[A-Z]{2}\b/g) ?? []) {
    if (!plate.startsWith("DM")) problems.push(`plate ${plate}`);
  }

  // The email editor's own sample values (obviously fake) are allowed alongside the seed's.
  const SAMPLE_PHONES = ["+39 0789 000000"];

  for (const phone of text.match(/\+\d[\d ]{7,}\d/g) ?? []) {
    if (!phone.startsWith("+39 000") && !SAMPLE_PHONES.includes(phone)) problems.push(`phone ${phone}`);
  }

  const lower = text.toLowerCase();

  for (const value of deny) if (lower.includes(value)) problems.push(`deny-listed value "${value}"`);

  if (problems.length) throw new Error(`${id}: real-looking data on screen: ${problems.join(", ")}`);
}

// ---------------------------------------------------------------- page helpers

const CALM = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
  nextjs-portal, [data-nextjs-toast] { display: none !important; }
`;

async function signIn(page) {
  await page.goto(`${PANEL}/login`);
  await page.getByLabel("Email").fill(demo.admin_email);
  await page.getByLabel("Password").fill(demo.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor();
}

async function open(page, path) {
  await page.goto(`${PANEL}${path}`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: CALM });
  await page.waitForTimeout(600);
}

/** The calendar labels a day in the business locale (en-GB here), e.g. "Monday 2 November 2026". Matches either order. */
function dayPattern(date) {
  const day = date.getDate();
  const month = date.toLocaleDateString("en-GB", { month: "long" });
  const year = date.getFullYear();

  return new RegExp(String.raw`\b${day} ${month} ${year}\b|\b${month} ${day}(st|nd|rd|th)?,? ${year}\b`);
}

async function pickDay(page, date) {
  const day = page.getByRole("button", { name: dayPattern(date) });

  for (let i = 0; i < 12 && !(await day.isVisible().catch(() => false)); i++) {
    await page.getByRole("button", { name: "Next month" }).click();
  }

  await day.click();
}

/** Draws an invented signature (a looping scrawl and an underline) on a signature pad on screen. It is never saved. */
async function scribble(page, index = 0) {
  const pad = page.locator("canvas").nth(index);
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];

  await page.mouse.move(...at(0.14, 0.62));
  await page.mouse.down();

  for (let i = 0; i <= 90; i++) {
    const t = i / 90;
    const x = 0.14 + 0.7 * t;
    const y = 0.52 - 0.3 * Math.sin(t * Math.PI * 5.5) * (1 - 0.55 * t) + 0.06 * Math.cos(t * Math.PI * 11);

    await page.mouse.move(...at(x, y));
  }

  await page.mouse.up();
  await page.mouse.move(...at(0.2, 0.86));
  await page.mouse.down();
  await page.mouse.move(...at(0.82, 0.8), { steps: 14 });
  await page.mouse.up();
}

async function scrollTo(page, locator, offset = 90) {
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate((o) => window.scrollBy(0, -o), offset);
  await page.waitForTimeout(250);
}

// ---------------------------------------------------------------- the shots

// id: matches content/screens.ts and public/screens/<id>-<width>.webp
// kind "browser": panel at 1440x900 (2x); "phone": booking site at 390x844 (3x)
const SHOTS = [
  {
    id: "dashboard",
    kind: "browser",
    async run(page) {
      await open(page, "/");
      await page.getByText("Next pickups").waitFor();
    },
  },
  {
    id: "audit",
    kind: "browser",
    async run(page) {
      await open(page, "/admin/audit-log");
      // One person's actions read cleaner than everything, and show the filter.
      await page.getByLabel("User").selectOption({ label: demo.users.manager });
      await page.waitForTimeout(900);
    },
  },
  {
    id: "wizard",
    kind: "browser",
    async run(page) {
      await open(page, "/reservations/new");
      // Olbia: the options read "OLB — Olbia Airport"; the list is alphabetical by code.
      const olbia = await page.getByLabel("Pickup location").locator("option", { hasText: "OLB" }).first().getAttribute("value");
      await page.getByLabel("Pickup location").selectOption(olbia);
      const start = new Date();
      start.setDate(start.getDate() + 26);
      const end = new Date(start);
      end.setDate(end.getDate() + 4);
      await pickDay(page, start);
      await pickDay(page, end);
      await page.getByRole("button", { name: "Search vehicles" }).click();
      await page.getByRole("button", { name: "Select", exact: true }).first().waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    id: "reservation",
    kind: "browser",
    async run(page) {
      await open(page, `/reservations/manage/${demo.reservations.provisional}`);
      await page.getByText("Confirm this car").waitFor();
    },
  },
  {
    id: "fleet",
    kind: "browser",
    async run(page) {
      await open(page, "/cars");
      await page.getByText("Fleet Overview").waitFor();
      await page.evaluate(() => (document.body.style.zoom = "0.8"));
      await page.waitForTimeout(400);
    },
  },
  {
    id: "handover",
    kind: "browser",
    async run(page) {
      await open(page, `/handovers/${demo.reservations.handover}/check-in`);
      const heading = page.getByText("Customer Signature").first();
      await heading.waitFor();
      await page.evaluate(() => (document.body.style.zoom = "0.8"));
      await scrollTo(page, heading, 150);
      await scribble(page, 0);
      await page.waitForTimeout(300);
    },
  },
  {
    id: "classes",
    kind: "browser",
    async run(page) {
      await open(page, "/admin/configuration/classes");
      await page.getByText("Vehicle classes").first().waitFor();
      await page.evaluate(() => (document.body.style.zoom = "0.8"));
      await page.waitForTimeout(400);
    },
  },
  {
    id: "email",
    kind: "browser",
    async run(page) {
      await open(page, "/admin/configuration/email/booking_confirmed");
      await page.getByRole("button", { name: "Preview", exact: true }).first().click();
      await page.getByText("Nothing is sent").waitFor();
      await page.waitForTimeout(600);
      await page.evaluate(() => (document.body.style.zoom = "0.8"));
    },
  },
  {
    id: "revenue",
    kind: "browser",
    async run(page) {
      await open(page, "/admin/revenue");
      const from = new Date();
      from.setDate(from.getDate() - 84);
      await page.locator('input[type="date"]').first().fill(from.toISOString().slice(0, 10));
      await page.waitForTimeout(1200);
      await page.evaluate(() => (document.body.style.zoom = "0.8"));
      await page.waitForTimeout(300);
    },
  },
  {
    id: "storefront",
    kind: "phone",
    async run(page) {
      await page.goto(`${STORE}/fleet`, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: CALM });
      await page.waitForTimeout(800);
    },
  },
  // Saves a condition on the overdue rental, so it must be last, and the seed must be fresh.
  {
    id: "checkout",
    kind: "browser",
    async run(page) {
      await open(page, `/handovers/${demo.reservations.checkout}/check-out`);
      const mileage = page.getByLabel(/Mileage/);
      await mileage.waitFor();
      const current = Number(await mileage.inputValue());
      await mileage.fill(String(current + 340));
      await page.getByLabel("Fuel level").selectOption({ index: 3 });
      await page.getByRole("button", { name: "Save condition" }).click();
      const charges = page.getByText(/Late fee/i).first();
      await charges.waitFor();
      await scrollTo(page, charges, 220);
    },
  },
];

// ---------------------------------------------------------------- run

const sizes = { browser: [800, 1600], phone: [390, 780] };
const viewports = {
  browser: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch();
const report = {};
let failed = 0;

try {
  for (const kind of ["browser", "phone"]) {
    const shots = SHOTS.filter((s) => s.kind === kind && (!only?.length || only.includes(s.id)));
    if (!shots.length) continue;

    const context = await browser.newContext({ ...viewports[kind], locale: "en-GB", timezoneId: "Europe/Rome", colorScheme: "light" });
    const page = await context.newPage();
    if (kind === "browser") await signIn(page);

    for (const shot of shots) {
      try {
        await shot.run(page);
        await assertNoRealData(page, shot.id);

        const png = await page.screenshot({ type: "png" });
        const files = {};

        for (const width of sizes[kind]) {
          const buffer = await sharp(png).resize({ width }).webp({ quality: 82, effort: 5 }).toBuffer();
          const name = `${shot.id}-${width}.webp`;
          writeFileSync(join(outDir, name), buffer);
          files[width] = { file: name, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex").slice(0, 16) };
        }

        report[shot.id] = { kind, source: `${(await page.evaluate(() => [innerWidth, innerHeight])).join("x")}`, files };
        console.log(`✓ ${shot.id}  ${Object.values(files).map((f) => `${f.file} ${(f.bytes / 1024).toFixed(0)} KB`).join(", ")}`);
      } catch (error) {
        failed++;
        console.error(`✗ ${shot.id}: ${error.message.split("\n")[0]}`);
        // What the page looked like when it failed, to see why (gitignored).
        await page.screenshot({ path: join(here, `failed-${shot.id}.png`) }).catch(() => {});
      }
    }

    await context.close();
  }
} finally {
  await browser.close();
}

const manifestFile = join(outDir, "manifest.json");
const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { shots: {} };

writeFileSync(
  manifestFile,
  JSON.stringify({ seedBuiltAt: demo.built_at, business: demo.business, shots: { ...previous.shots, ...report } }, null, 2) + "\n",
);

console.log(failed ? `\n${failed} shot(s) failed.` : "\nAll shots captured.");
process.exit(failed ? 1 : 0);
