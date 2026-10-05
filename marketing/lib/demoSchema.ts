import { COUNTRY_CODES } from "@shared/countries";

// The demo request, validated the same way in the browser (to show errors early)
// and on the server (the only place that counts). Error messages are CODES, not
// sentences: the form maps each to wording in the catalogue.
//
// Plain functions, not a schema library: the rules are six, and a library would
// ship to every visitor's browser (Next prefetches the form page's code from every page).

export const FLEET_SIZES = ["1-10", "11-30", "31-60", "60+"] as const;
export type FleetSize = (typeof FLEET_SIZES)[number];

export const LIMITS = { name: 100, company: 150, email: 254, message: 2000 } as const;

export type ErrorCode = "required" | "too_long" | "invalid_email" | "invalid_choice" | "line_break";
export type FieldName = "name" | "company" | "email" | "country" | "fleet" | "message";

export type DemoRequest = {
  name: string;
  company: string;
  email: string;
  country: string;
  fleet: FleetSize;
  message: string;
};

export type ParseResult = { ok: true; data: DemoRequest } | { ok: false; errors: Partial<Record<FieldName, ErrorCode>> };

// A line break in a field that ends up in an email header or subject is how
// header injection works, so single-line fields refuse one outright. \p{Zl} and
// \p{Zp} are the Unicode line and paragraph separators.
const LINE_BREAK = /[\r\n\p{Zl}\p{Zp}]/u;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Checks a required single-line text field. Returns the trimmed text or the first problem. */
function singleLine(value: unknown, max: number): { value: string } | { error: ErrorCode } {
  if (typeof value !== "string") return { error: "required" };

  const text = value.trim();

  if (text === "") return { error: "required" };
  if (text.length > max) return { error: "too_long" };
  if (LINE_BREAK.test(text)) return { error: "line_break" };

  return { value: text };
}

/** Validates the demo fields of an unknown body. Reports the first problem of each field. */
export function parseDemoRequest(input: unknown): ParseResult {
  const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const errors: Partial<Record<FieldName, ErrorCode>> = {};

  const name = singleLine(body.name, LIMITS.name);
  const company = singleLine(body.company, LIMITS.company);
  const email = singleLine(body.email, LIMITS.email);

  if ("error" in name) errors.name = name.error;
  if ("error" in company) errors.company = company.error;

  if ("error" in email) errors.email = email.error;
  else if (!EMAIL.test(email.value)) errors.email = "invalid_email";

  const country = body.country;

  if (typeof country !== "string") errors.country = "required";
  else if (!COUNTRY_CODES.includes(country)) errors.country = "invalid_choice";

  const fleet = body.fleet;

  if (typeof fleet !== "string" || !(FLEET_SIZES as readonly string[]).includes(fleet)) errors.fleet = "invalid_choice";

  const rawMessage = body.message;
  const message = rawMessage === undefined || rawMessage === null ? "" : typeof rawMessage === "string" ? rawMessage.trim() : null;

  if (message === null) errors.message = "required";
  else if (message.length > LIMITS.message) errors.message = "too_long";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      name: (name as { value: string }).value,
      company: (company as { value: string }).value,
      email: (email as { value: string }).value,
      country: country as string,
      fleet: fleet as FleetSize,
      message: message as string,
    },
  };
}
