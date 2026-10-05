/**
 * What the browser tells us when a page does something the Content-Security-
 * Policy would block (see shared/csp.ts). Boiled down to a line for the container
 * log, so a violation can be found with a log query while a stack is running
 * report-only, before enforcement is switched on.
 *
 * The same file lives in storefront/lib/cspReport.ts and frontend/lib/cspReport.ts: each app is built from its
 * own folder, so they cannot share it.
 */

const URL_FIELDS = ["document-uri", "blocked-uri", "source-file"] as const;
const TEXT_FIELDS = ["violated-directive", "effective-directive", "disposition"] as const;

const MAX_LENGTH = 200;

/** A report is at most a few hundred bytes; anything bigger is not one. */
export const MAX_REPORT_BYTES = 16 * 1024;

// Web addresses can carry personal data in the query or fragment (tokens,
// references), and the report is written to a log. Only the part up to there is kept.
function withoutQuery(value: string): string {
  return value.split(/[?#]/)[0].slice(0, MAX_LENGTH);
}

/** The useful, safe part of a report body, or null if it is not a violation report. */
export function summarizeCspReport(body: unknown): Record<string, string | number> | null {
  const report = (body as { "csp-report"?: unknown } | null)?.["csp-report"];

  if (typeof report !== "object" || report === null) return null;

  const source = report as Record<string, unknown>;
  const summary: Record<string, string | number> = {};

  for (const field of URL_FIELDS) {
    if (typeof source[field] === "string") summary[field] = withoutQuery(source[field]);
  }

  for (const field of TEXT_FIELDS) {
    if (typeof source[field] === "string") summary[field] = (source[field] as string).slice(0, MAX_LENGTH);
  }

  if (typeof source["line-number"] === "number") summary["line-number"] = source["line-number"];

  return "violated-directive" in summary || "effective-directive" in summary ? summary : null;
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

let windowStart = 0;
let seen = 0;

/**
 * Whether one more report may be logged. A broken page can fire thousands of
 * identical reports, and anyone can post to this address, so only a handful per
 * minute reach the log.
 */
export function allowReport(now: number = Date.now()): boolean {
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    seen = 0;
  }

  seen += 1;

  return seen <= MAX_PER_WINDOW;
}
