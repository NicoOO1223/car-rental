import { describe, expect, it } from "vitest";

import { ANNUAL_MONTHS, INCLUDED, PRICES_CONFIRMED, plans, shownPrice, shownSetupFee } from "@/content/plans";

import { messages } from "./helpers";

describe("plans", () => {
  it("are ordered by fleet size, the last one uncapped", () => {
    const caps = plans.map((plan) => plan.vehicles);

    expect(caps).toEqual([10, 30, null]);
  });

  it("highlight exactly one plan", () => {
    expect(plans.filter((plan) => plan.highlighted)).toHaveLength(1);
  });

  it("include the same features in every plan: there is no gating in the product", () => {
    // The included list is global, not per plan.
    expect(INCLUDED.length).toBeGreaterThan(0);

    for (const key of INCLUDED) expect(messages[`pricing.include.${key}`], key).toBeTruthy();
  });

  it("show no price while prices are unconfirmed, so a placeholder can never ship", () => {
    if (!PRICES_CONFIRMED) {
      for (const plan of plans) expect(shownPrice(plan)).toBeNull();

      expect(shownSetupFee()).toBeNull();
    }
  });

  it("never show a plan with an empty price once prices are confirmed", () => {
    if (PRICES_CONFIRMED) for (const plan of plans) expect(shownPrice(plan), plan.id).not.toBeNull();
  });

  it("offers two free months for paying yearly", () => {
    expect(ANNUAL_MONTHS).toBe(10);
    expect(messages["pricing.annual"]).toMatch(/two months free/i);
  });

  it("have a name in the catalogue", () => {
    for (const plan of plans) expect(messages[`pricing.${plan.id}`], plan.id).toBeTruthy();
  });
});
