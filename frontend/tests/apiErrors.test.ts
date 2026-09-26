import { beforeAll, describe, expect, it } from "vitest";

import { errorText } from "@/lib/apiErrors";
import { loadMessages, setActiveLanguage } from "@/lib/i18n";

describe("errorText", () => {
  beforeAll(async () => setActiveLanguage("it", await loadMessages("it")));

  it("words a coded error in the reader's language, with its values", () => {
    const text = errorText({
      detail: "English detail",
      code: "location.in_use",
      params: { vehicles: 2, reservations: 0, both: "no" },
    });

    expect(text).not.toBe("English detail");
    expect(text).toContain("2");
  });

  it("falls back to the server's English for a code this build does not know", () => {
    expect(errorText({ detail: "Newer server sentence.", code: "brand.new_code" })).toBe(
      "Newer server sentence.",
    );
  });

  it("uses the generic message when the body has nothing usable", () => {
    expect(errorText(null, "errors.generic.load")).toBeTruthy();
    expect(errorText({}, "errors.generic.load")).toBeTruthy();
  });

  it("shows the first thing wrong for a validation error", () => {
    const text = errorText({
      code: "validation.failed",
      errors: [{ field: "email", code: "validation.password_too_short", message: "too short", params: {} }],
    });

    expect(text.length).toBeGreaterThan(0);
  });
});
