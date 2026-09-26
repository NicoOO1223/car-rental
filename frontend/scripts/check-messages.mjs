// Checks the interface language catalogs (frontend/messages/*.json).
//
//   node scripts/check-messages.mjs           report problems, fail on real ones
//   node scripts/check-messages.mjs --strict  also fail on text still hardcoded in components
//
// Real problems, always fatal:
//   - a key in one language and not in another (a missing translation shows
//     English, an extra key is dead text)
//   - a message whose {placeholders} differ from the English one (a translated
//     sentence that drops or renames {count} shows a blank or breaks)
//   - an empty message
//   - a server error code (backend/app/**) that has no "errors.<code>" message
//
// Hardcoded text in components is reported as a count and only fatal with
// --strict, which is switched on in CI once every screen is extracted.
//
// Plain JavaScript (not TypeScript) so it runs on the Node 20 that CI uses.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const messagesDir = join(root, "messages");
const strict = process.argv.includes("--strict");

const LANGUAGES = readdirSync(messagesDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(".json", ""));

if (!LANGUAGES.includes("en")) {
  console.error("messages/en.json is the source and must exist.");
  process.exit(1);
}

function flatten(object, prefix = "") {
  const out = {};

  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }

  return out;
}

// The names of the arguments a message uses ({count}, {name, plural, ...}),
// found by reading the ICU syntax rather than pattern matching: the words
// inside a plural or select branch are text, not arguments.
function placeholders(message) {
  const names = new Set();
  let position = 0;

  function skipSpaces() {
    while (position < message.length && /\s/.test(message[position])) position++;
  }

  function readWord() {
    skipSpaces();
    const from = position;

    while (position < message.length && /[A-Za-z0-9_=.#-]/.test(message[position])) position++;

    return message.slice(from, position);
  }

  // Text up to the closing brace of the enclosing branch (or the end).
  function parseText() {
    while (position < message.length) {
      const char = message[position];

      if (char === "}") return;

      if (char === "{") {
        position++;
        parseArgument();
      } else {
        position++;
      }
    }
  }

  function parseArgument() {
    const name = readWord();

    if (name) names.add(name);

    skipSpaces();

    if (message[position] === ",") {
      position++;
      const type = readWord();
      skipSpaces();

      if (message[position] === ",") position++;

      if (["plural", "select", "selectordinal"].includes(type)) {
        // selector { text } selector { text } ...
        for (;;) {
          skipSpaces();

          if (position >= message.length || message[position] === "}") break;

          readWord(); // the selector: one, other, =0, yes ...
          skipSpaces();

          if (message[position] !== "{") break;

          position++;
          parseText();

          if (message[position] === "}") position++;
        }
      } else {
        // {n, number} and friends: skip to the end of the argument.
        while (position < message.length && message[position] !== "}") position++;
      }
    }

    if (message[position] === "}") position++;
  }

  parseText();

  return [...names].sort();
}

const catalogs = Object.fromEntries(
  LANGUAGES.map((language) => [
    language,
    flatten(JSON.parse(readFileSync(join(messagesDir, `${language}.json`), "utf8"))),
  ]),
);

const english = catalogs.en;
let problems = 0;

function fail(message) {
  problems++;
  console.error(`  ✗ ${message}`);
}

for (const language of LANGUAGES) {
  console.log(`${language}: ${Object.keys(catalogs[language]).length} messages`);

  if (language === "en") continue;

  const catalog = catalogs[language];

  for (const key of Object.keys(english)) {
    if (!(key in catalog)) fail(`${language}: missing "${key}"`);
  }

  for (const key of Object.keys(catalog)) {
    if (!(key in english)) fail(`${language}: "${key}" is not in en.json`);
  }

  for (const [key, message] of Object.entries(catalog)) {
    if (!message.trim()) fail(`${language}: "${key}" is empty`);

    if (key in english) {
      const want = placeholders(english[key]).join(", ");
      const have = placeholders(message).join(", ");

      if (want !== have) {
        fail(`${language}: "${key}" has placeholders {${have}}, English has {${want}}`);
      }
    }
  }
}

for (const [key, message] of Object.entries(english)) {
  if (!message.trim()) fail(`en: "${key}" is empty`);
}

// --- Server error codes have messages ---------------------------------------------------------

const backend = join(root, "..", "backend", "app");

function walk(directory) {
  const files = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      if (entry !== "__pycache__") files.push(...walk(path));
    } else if (entry.endsWith(".py")) {
      files.push(path);
    }
  }

  return files;
}

if (existsSync(backend)) {
  const codes = new Set();

  for (const file of walk(backend)) {
    const text = readFileSync(file, "utf8");

    // AppError("code", ...), NotFoundError("code", ...), PydanticCustomError("code", ...)
    for (const match of text.matchAll(/\b(?:AppError|NotFoundError|ConflictError|PydanticCustomError)\(\s*"([a-z0-9_.]+)"/g)) {
      codes.add(match[1]);
    }
  }

  for (const code of [...codes].sort()) {
    if (!(`errors.${code}` in english)) fail(`server error code "${code}" has no "errors.${code}" message`);
  }

  console.log(`server error codes: ${codes.size}`);
}

// --- Text still hardcoded in components --------------------------------------------------------

const PLAIN_PROP = /\b(label|placeholder|title|aria-label|hint|description|alt)="([^"{}]*[A-Za-z]{2,}[^"{}]*)"/g;
const JSX_TEXT = />\s*([A-Z][A-Za-z][^<>{}\n]{2,})\s*</g;

const hardcoded = [];

for (const directory of ["app", "components"]) {
  for (const file of (function collect(dir) {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);

      return statSync(path).isDirectory() ? collect(path) : path.endsWith(".tsx") ? [path] : [];
    });
  })(join(root, directory))) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");

    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;

      for (const match of line.matchAll(PLAIN_PROP)) {
        // Class names, ids and URLs are not text a person reads.
        if (!/^[a-z0-9:_./-]+$/.test(match[2])) {
          hardcoded.push(`${relative(root, file)}:${index + 1}  ${match[1]}="${match[2]}"`);
        }
      }

      for (const match of line.matchAll(JSX_TEXT)) {
        hardcoded.push(`${relative(root, file)}:${index + 1}  >${match[1].trim()}<`);
      }
    });
  }
}

console.log(`hardcoded text still in components: ${hardcoded.length}`);

if (process.argv.includes("--list")) {
  for (const entry of hardcoded) console.log(`  ${entry}`);
}

if (strict && hardcoded.length > 0) {
  fail(`${hardcoded.length} hardcoded strings (run with --list to see them)`);
}

if (problems > 0) {
  console.error(`\n${problems} problem${problems === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("Catalogs are consistent.");
