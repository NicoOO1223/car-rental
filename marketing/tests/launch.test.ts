import { describe, expect, it } from "vitest";

import { brand, isPlaceholderEmail, isTodo, missingLegalFields } from "@/content/brand";
import { UNCONFIRMED_COPY } from "@/content/launch";
import { PRICES_CONFIRMED } from "@/content/plans";

// The gate between "built" and "may go public". It is skipped in the normal
// test run (the site is a draft on purpose) and enforced by `npm run check:launch`,
// which the launch build and the deploy workflow run with LAUNCH_GATE=1.
const gate = process.env.LAUNCH_GATE === "1" ? describe : describe.skip;

gate("launch gate", () => {
  it("has a real brand name and domain", () => {
    expect(brand.placeholder, "brand.placeholder is still true").toBe(false);
    expect(isTodo(brand.domain), "brand.domain is TODO").toBe(false);
  });

  it("has a contact address", () => {
    expect(isPlaceholderEmail(brand.contactEmail), "brand.contactEmail is still a placeholder").toBe(false);
  });

  it("has the legal entity details", () => {
    expect(missingLegalFields()).toEqual([]);
  });

  it("has legal pages approved by a lawyer", () => {
    expect(brand.legalReviewed, "brand.legalReviewed is false").toBe(true);
  });

  it("has confirmed prices", () => {
    expect(PRICES_CONFIRMED, "PRICES_CONFIRMED is false").toBe(true);
  });

  it("has every promise and term confirmed", () => {
    expect(UNCONFIRMED_COPY, "copy still waiting for the owner or the lawyer").toEqual([]);
  });
});
