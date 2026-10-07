import { describe, expect, it } from "vitest";

import { DEFAULT_ACCENT, accentInk, accentVariables, contrast, normalizeAccent, onAccent } from "@/lib/accent";

// A spread of brand colours a business might pick, from near-black to pale.
const CHOICES = ["#0a0a0a", "#1f4fd8", "#0d7a5f", "#c2410c", "#7c3aed", "#facc15", "#93c5fd", "#ffffff", "#ff0000", "#00ff00"];

describe("normalizeAccent", () => {
  it("keeps a six-digit hex colour, lower-cased", () => {
    expect(normalizeAccent(" #1F4FD8 ")).toBe("#1f4fd8");
  });

  it("falls back to the default for anything else", () => {
    for (const bad of [null, undefined, "", "blue", "#fff", "1f4fd8", "#1f4fd8;color:red", "url(x)"]) {
      expect(normalizeAccent(bad)).toBe(DEFAULT_ACCENT);
    }
  });
});

describe("onAccent", () => {
  it("puts white on dark colours and near-black on light ones", () => {
    expect(onAccent("#0a0a0a")).toBe("#ffffff");
    expect(onAccent("#1f4fd8")).toBe("#ffffff");
    expect(onAccent("#facc15")).toBe("#0a0a0a");
    expect(onAccent("#ffffff")).toBe("#0a0a0a");
  });

  it("is always readable on the colour it sits on", () => {
    for (const accent of CHOICES) {
      expect(contrast(accent, onAccent(accent))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("accentInk", () => {
  it("leaves a colour that already reads on white as it is", () => {
    expect(accentInk("#1f4fd8")).toBe("#1f4fd8");
    expect(accentInk("#0a0a0a")).toBe("#0a0a0a");
  });

  it("darkens a pale colour until it reads on white", () => {
    for (const accent of CHOICES) {
      expect(contrast(accentInk(accent), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }

    expect(accentInk("#facc15")).not.toBe("#facc15");
  });
});

describe("accentVariables", () => {
  it("gives the three variables the stylesheet builds on", () => {
    expect(accentVariables("#1F4FD8")).toEqual({
      "--accent": "#1f4fd8",
      "--on-accent": "#ffffff",
      "--accent-ink": "#1f4fd8",
    });
  });

  it("never lets a malformed value into a style attribute", () => {
    expect(accentVariables("red; background: url(x)")["--accent"]).toBe(DEFAULT_ACCENT);
  });
});
