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

// --- Every key the code asks for exists --------------------------------------------------------

{
  const used = new Map();

  for (const directory of ["app", "components", "lib"]) {
    for (const file of (function collect(dir) {
      return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);

        return statSync(path).isDirectory() ? collect(path) : /\.tsx?$/.test(path) ? [path] : [];
      });
    })(join(root, directory))) {
      const text = readFileSync(file, "utf8");

      for (const match of text.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) {
        if (!used.has(match[1])) used.set(match[1], relative(root, file));
      }
    }
  }

  for (const [key, file] of used) {
    if (!(key in english)) fail(`${file}: t("${key}") has no message in en.json`);
  }

  console.log(`keys used in code: ${used.size}`);
}

// --- Calls pass the values their message needs --------------------------------------------------

{
  const { default: ts } = await import("typescript");

  for (const directory of ["app", "components", "lib"]) {
    for (const file of (function collect(dir) {
      return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);

        return statSync(path).isDirectory() ? collect(path) : /\.tsx?$/.test(path) ? [path] : [];
      });
    })(join(root, directory))) {
      const source = readFileSync(file, "utf8");

      if (!/\bt\(/.test(source)) continue;

      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

      (function visit(node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments.length >= 1) {
          const keys = [];

          (function collectKeys(expression) {
            if (ts.isStringLiteral(expression)) keys.push(expression.text);
            else if (ts.isConditionalExpression(expression)) {
              collectKeys(expression.whenTrue);
              collectKeys(expression.whenFalse);
            } else if (ts.isParenthesizedExpression(expression)) collectKeys(expression.expression);
          })(node.arguments[0]);

          const values = node.arguments[1];
          let given = null;

          if (values && ts.isObjectLiteralExpression(values)) {
            given = new Set(values.properties.map((property) => property.name?.getText(sf)).filter(Boolean));
          } else if (!values) {
            given = new Set();
          }

          if (given) {
            for (const key of keys) {
              if (!(key in english)) continue;

              for (const name of placeholders(english[key])) {
                if (!given.has(name)) {
                  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
                  fail(`${relative(root, file)}:${line + 1}  t("${key}") needs {${name}} but the call does not pass it`);
                }
              }
            }
          }
        }

        ts.forEachChild(node, visit);
      })(sf);
    }
  }
}

// --- Text still hardcoded in components --------------------------------------------------------
//
// Reads the code (not a pattern over its text) and lists every string that looks
// like a sentence or a label a person would read: text between tags, text
// props, and quoted strings in expressions. Class lists, ids, codes, comparisons
// and error text meant for developers are left alone.

const hardcoded = [];

{
  const { default: ts } = await import("typescript");

  const NON_TEXT_ATTRIBUTES = new Set([
    "className", "type", "href", "id", "name", "htmlFor", "key", "value", "role", "autoComplete",
    "inputMode", "target", "rel", "src", "method", "variant", "size", "tone", "icon", "width",
    "height", "viewBox", "d", "fill", "stroke", "style", "pattern", "accept", "mode",
    "autoCapitalize", "preserveAspectRatio", "xmlns", "transform", "points", "cx", "cy", "r",
  ]);
  const NON_TEXT_PROPERTIES = new Set([
    "className", "type", "href", "value", "key", "id", "icon", "name", "variant", "tone", "color",
    "kind", "status", "role", "method", "field", "sort", "code", "transition", "transformOrigin",
  ]);
  const NEUTRAL_CALLS = new Set([
    "t", "hasMessage", "enumLabel", "enumLabelLower", "require", "useState", "createContext",
    "useRef", "fetch", "apiFetch",
  ]);
  const NEUTRAL_METHODS = new Set([
    "includes", "startsWith", "endsWith", "getItem", "setItem", "removeItem", "get", "set", "append",
    "has", "querySelector", "querySelectorAll", "addEventListener", "removeEventListener", "log",
    "warn", "push", "matches", "test", "padStart", "split", "join", "replace", "replaceAll",
    "localeCompare", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "closest",
    "getAttribute", "setAttribute", "createElement", "then", "catch", "error",
  ]);
  const COMPARISONS = new Set([
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ]);
  // Files whose English-looking strings are names, not interface text.
  const IGNORED_FILES = new Set(["lib/i18n.ts", "lib/localization.ts", "lib/countries.ts", "lib/csp.ts"]);

  const BARE_UTILITIES = new Set(["flex", "grid", "hidden", "block", "inline", "relative", "absolute", "fixed", "sticky", "uppercase", "lowercase", "capitalize", "truncate", "italic", "underline", "border", "rounded", "shadow", "transition", "container", "static", "contents"]);

  function isClassList(text) {
    const words = text.replaceAll("{}", " ").trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) return true;

    const classy = words.filter((word) => BARE_UTILITIES.has(word) || (/^[a-z!\[]/.test(word) && /[-:\[\]\/]/.test(word))).length;

    return classy >= Math.ceil(words.length / 2) && !/^[A-Z]/.test(text.trim());
  }

  function looksLikeText(text) {
    if (text === "use client" || text === "Bearer ") return false;
    if (!/[A-Za-z]{2,}/.test(text)) return false;
    if (/^[a-z0-9_:./#-]+$/.test(text)) return false; // ids, urls
    if (/^[A-Z0-9_]+$/.test(text)) return false; // enum codes
    if (/^[a-z]+([A-Z][a-z]+)+$/.test(text)) return false; // camelCase identifiers
    if (/^[A-Z ]{2,}( [A-Z]{2}){2,}$/.test(text)) return false; // country code lists
    if (isClassList(text)) return false;
    if (/[\[\]{}]/.test(text) && !/\s/.test(text.trim().slice(0, 12))) return false; // selectors

    return /\s/.test(text.trim()) || /^[A-Z][a-z]{2,}/.test(text);
  }

  function isCandidate(node) {
    const parent = node.parent;

    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && NEUTRAL_CALLS.has(parent.expression.text)) return false;
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
      if (NEUTRAL_METHODS.has(parent.expression.name.text)) return false;
      if (parent.expression.expression.getText() === "console") return false;
    }
    // new Error("...") is for developers, not for people using the app.
    if (ts.isNewExpression(parent) && parent.expression.getText() === "Error") return false;
    if (ts.isBinaryExpression(parent) && COMPARISONS.has(parent.operatorToken.kind)) return false;
    if (ts.isCaseClause(parent) || ts.isElementAccessExpression(parent) || ts.isLiteralTypeNode(parent) || ts.isEnumMember(parent)) return false;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
    if (ts.isJsxAttribute(parent)) return !NON_TEXT_ATTRIBUTES.has(parent.name.getText());
    if (ts.isPropertyAssignment(parent) && NON_TEXT_PROPERTIES.has(parent.name.getText())) return false;
    if (parent.parent && ts.isTypeNode(parent.parent)) return false;

    return true;
  }

  for (const directory of ["app", "components", "lib"]) {
    for (const file of (function collect(dir) {
      return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);

        return statSync(path).isDirectory() ? collect(path) : /\.tsx?$/.test(path) ? [path] : [];
      });
    })(join(root, directory))) {
      const shown = relative(root, file).replaceAll("\\", "/");

      if (IGNORED_FILES.has(shown)) continue;

      const source = readFileSync(file, "utf8");
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

      (function visit(node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return;

        let text = null;

        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
        else if (ts.isTemplateExpression(node)) text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("{}");
        else if (ts.isJsxText(node)) text = node.text.replace(/\s+/g, " ").trim();

        if (text !== null && text !== "" && looksLikeText(text) && (ts.isJsxText(node) || isCandidate(node))) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));

          hardcoded.push(`${shown}:${line + 1}  ${JSON.stringify(text).slice(0, 80)}`);
        }

        ts.forEachChild(node, visit);
      })(sf);
    }
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
