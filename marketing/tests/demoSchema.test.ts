import { describe, expect, it } from "vitest";

import { FLEET_SIZES, LIMITS, parseDemoRequest } from "@/lib/demoSchema";

const valid = { name: "Ada Lovelace", company: "Isola Rent", email: "ada@example.com", country: "IT", fleet: "11-30", message: "Two airports." };

function errorsOf(overrides: Record<string, unknown>) {
  const result = parseDemoRequest({ ...valid, ...overrides });

  return result.ok ? null : result.errors;
}

describe("demo request validation", () => {
  it("accepts a complete request", () => {
    const result = parseDemoRequest(valid);

    expect(result.ok).toBe(true);
  });

  it("trims every text field", () => {
    const result = parseDemoRequest({ ...valid, name: "  Ada  ", company: " Isola Rent ", email: " ada@example.com ", message: "  hi  " });

    expect(result.ok && result.data).toMatchObject({ name: "Ada", company: "Isola Rent", email: "ada@example.com", message: "hi" });
  });

  it("treats the message as optional", () => {
    const { message, ...rest } = valid;
    void message;
    const result = parseDemoRequest(rest);

    expect(result.ok && result.data.message).toBe("");
  });

  it("reports a code for every missing required field", () => {
    const result = parseDemoRequest({});

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual({
      name: "required",
      company: "required",
      email: "required",
      country: "required",
      fleet: "invalid_choice",
    });
  });

  it("treats a blank required field as missing", () => {
    expect(errorsOf({ name: "   " })).toEqual({ name: "required" });
    expect(errorsOf({ company: "" })).toEqual({ company: "required" });
  });

  it("refuses a malformed email", () => {
    for (const email of ["ada", "ada@", "@example.com", "ada@example", "a da@example.com"]) {
      expect(errorsOf({ email }), email).toEqual({ email: "invalid_email" });
    }
  });

  it("refuses a country that is not an ISO code", () => {
    expect(errorsOf({ country: "Italy" })).toEqual({ country: "invalid_choice" });
    expect(errorsOf({ country: "ZZ" })).toEqual({ country: "invalid_choice" });
    expect(errorsOf({ country: "" })).toEqual({ country: "invalid_choice" });
  });

  it("accepts only the offered fleet ranges", () => {
    for (const fleet of FLEET_SIZES) expect(errorsOf({ fleet }), fleet).toBeNull();

    expect(errorsOf({ fleet: "500" })).toEqual({ fleet: "invalid_choice" });
  });

  it("caps the length of each field", () => {
    expect(errorsOf({ name: "a".repeat(LIMITS.name + 1) })).toEqual({ name: "too_long" });
    expect(errorsOf({ company: "a".repeat(LIMITS.company + 1) })).toEqual({ company: "too_long" });
    expect(errorsOf({ message: "a".repeat(LIMITS.message + 1) })).toEqual({ message: "too_long" });
    expect(errorsOf({ message: "a".repeat(LIMITS.message) })).toBeNull();
  });

  it("refuses a line break in a single-line field: that is how email header injection works", () => {
    expect(errorsOf({ name: "Ada\r\nBcc: victim@example.com" })).toEqual({ name: "line_break" });
    expect(errorsOf({ company: "Isola\nRent" })).toEqual({ company: "line_break" });
    expect(errorsOf({ email: "ada@example.com\r\nBcc: victim@example.com" })).toEqual({ email: "line_break" });
  });

  it("refuses the Unicode line and paragraph separators as well", () => {
    const separators = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];

    for (const separator of separators) expect(errorsOf({ name: `Ada${separator}Lovelace` })).toEqual({ name: "line_break" });
  });

  it("allows line breaks in the message, which is a body, not a header", () => {
    expect(errorsOf({ message: "Line one\nLine two" })).toBeNull();
  });

  it("ignores a body that is not an object", () => {
    expect(parseDemoRequest(null).ok).toBe(false);
    expect(parseDemoRequest("text").ok).toBe(false);
    expect(parseDemoRequest(42).ok).toBe(false);
  });

  it("reports the first problem of each field only", () => {
    const result = parseDemoRequest({ ...valid, email: "x".repeat(300) });

    expect(!result.ok && Object.keys(result.errors)).toEqual(["email"]);
  });
});
