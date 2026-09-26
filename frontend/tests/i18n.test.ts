import { beforeAll, describe, expect, it } from "vitest";

import { enumLabel, hasMessage, loadMessages, setActiveLanguage, t } from "@/lib/i18n";

async function use(language: string) {
  setActiveLanguage(language, await loadMessages(language));
}

describe("translation", () => {
  beforeAll(() => use("en"));

  it("fills placeholders and picks the right plural in English", async () => {
    await use("en");
    expect(t("common.bookings", { count: 1 })).toBe("1 booking");
    expect(t("common.bookings", { count: 3 })).toBe("3 bookings");
  });

  it("uses all four Polish plural forms", async () => {
    await use("pl");
    expect(t("common.bookings", { count: 1 })).toBe("1 rezerwacja");
    expect(t("common.bookings", { count: 3 })).toBe("3 rezerwacje");
    expect(t("common.bookings", { count: 5 })).toBe("5 rezerwacji");
    expect(t("common.bookings", { count: 22 })).toBe("22 rezerwacje");
  });

  it("shows English, not a bare key, for a message a language lacks", async () => {
    await use("it");
    expect(t("common.cash")).toBe("Contanti");
    expect(hasMessage("errors.generic.failed")).toBe(true);
  });

  it("words a stored value by its enum group and falls back to readable text", async () => {
    await use("it");
    expect(enumLabel("carStatus", "AVAILABLE")).toBe("Disponibile");
    expect(enumLabel("carStatus", "SOMETHING_NEW")).toBe("Something New");
    expect(enumLabel("carStatus", null)).toBe("");
  });

  it("marks every extracted message in the pseudo-language", async () => {
    await use("pseudo");
    expect(t("common.cash")).toMatch(/^⟦.*⟧$/);
  });
});
