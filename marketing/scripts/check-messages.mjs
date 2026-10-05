// Checks the marketing catalogs (messages/*.json): every language has the
// same keys as English, with the same {placeholders}, and none is empty.
//
// Plain JavaScript so it runs with nothing installed but Node.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");

function flatten(object, prefix = "") {
  const out = {};

  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }

  return out;
}

const placeholders = (message) => [...new Set([...message.matchAll(/\{\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort().join(",");

const catalogs = Object.fromEntries(
  readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => [file.replace(".json", ""), flatten(JSON.parse(readFileSync(join(directory, file), "utf8")))]),
);

const problems = [];
const english = catalogs.en;

if (!english) {
  console.error("messages/en.json is the source and must exist.");
  process.exit(1);
}

for (const [language, messages] of Object.entries(catalogs)) {
  for (const [key, message] of Object.entries(english)) {
    if (!(key in messages)) {
      problems.push(`${language}: missing "${key}"`);
    } else if (!messages[key].trim()) {
      problems.push(`${language}: "${key}" is empty`);
    } else if (placeholders(messages[key]) !== placeholders(message)) {
      problems.push(`${language}: "${key}" has different placeholders from English`);
    }
  }

  for (const key of Object.keys(messages)) {
    if (!(key in english)) problems.push(`${language}: "${key}" is not in English`);
  }

  console.log(`${language}: ${Object.keys(messages).length} messages`);
}

if (problems.length) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log("Catalogs are consistent.");
