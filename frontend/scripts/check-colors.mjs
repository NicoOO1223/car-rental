// Fails when a component colours something with a raw Tailwind palette class
// (text-gray-500, bg-amber-100, border-red-600 ...) instead of a design token
// (text-ink-muted, bg-warning-soft, border-danger ...).
//
// The tokens live in app/globals.css. They are what lets one brand colour
// restyle the whole app and what keeps greys, warnings and errors the same on
// every page; a raw class quietly opts out of both.
//
// Allowed on purpose: black or white with an opacity (bg-black/40,
// border-white/10), which are scrims and hairlines over photos and dark panels.
//
// Plain JavaScript so it runs with nothing installed but Node.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOLDERS = ["app", "components", "lib"];

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY = "text|bg|border|divide|ring|ring-offset|outline|fill|stroke|from|via|to|accent|caret|decoration|shadow|placeholder";

const RAW = new RegExp(
  `(?<![\\w-])(?:[a-z-]+:)*(?:${UTILITY})(?:-[trblxyse])?-(?:(?:${PALETTE})-\\d{2,3}|white|black)(/\\d+)?(?![\\w-])`,
  "g",
);

function files(folder) {
  const found = [];

  for (const name of readdirSync(folder)) {
    const path = join(folder, name);

    if (statSync(path).isDirectory()) found.push(...files(path));
    else if (/\.(tsx?|css)$/.test(name)) found.push(path);
  }

  return found;
}

const problems = [];

for (const folder of FOLDERS) {
  for (const path of files(join(root, folder))) {
    const lines = readFileSync(path, "utf8").split("\n");

    lines.forEach((line, index) => {
      for (const match of line.matchAll(RAW)) {
        const [found, opacity] = match;
        const literal = /-(white|black)(\/\d+)?$/.test(found);

        // A scrim or hairline: black or white, with an opacity.
        if (literal && opacity) continue;

        problems.push(`${relative(root, path).replaceAll("\\", "/")}:${index + 1}  ${found}`);
      }
    });
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`\n${problems.length} raw colour ${problems.length === 1 ? "class" : "classes"}. Use a token from app/globals.css instead.`);
  process.exit(1);
}

console.log("Colours: every class uses a design token.");
