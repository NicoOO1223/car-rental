// Plans and prices. Every plan includes the full product: no feature is gated
// (the code has no gating), so the plans differ only by fleet size.
//
// Prices are the owner's decision (see the design brief, section 5). Until
// PRICES_CONFIRMED is true and a plan has a number, the site shows "Ask for a
// quote" and emits no price in structured data.

export const PRICES_CONFIRMED = false;

export type PlanId = "starter" | "growth" | "fleet";

export type Plan = {
  id: PlanId;
  /** Vehicle cap, counted by us and contractual; the code does not block it. `null` = no cap, ask for a quote. */
  vehicles: number | null;
  /** Euro per month, excluding VAT. */
  monthly: number | null;
  /** True when the price is "from" (the largest plan). */
  from: boolean;
  highlighted: boolean;
};

export const CURRENCY = "EUR";
/** Paying yearly costs this many months. */
export const ANNUAL_MONTHS = 10;
/** One-time setup fee in euro, excluding VAT. */
export const SETUP_FEE: number | null = null;

export const plans: readonly Plan[] = [
  { id: "starter", vehicles: 10, monthly: null, from: false, highlighted: false },
  { id: "growth", vehicles: 30, monthly: null, from: false, highlighted: true },
  { id: "fleet", vehicles: null, monthly: null, from: true, highlighted: false },
];

/** What every plan includes, as message keys under `pricing.include`. */
export const INCLUDED = ["i1", "i2", "i3", "i4"] as const;

/** The price to show for a plan, or null when it must read "Ask for a quote". */
export function shownPrice(plan: Plan): number | null {
  return PRICES_CONFIRMED ? plan.monthly : null;
}

export function shownSetupFee(): number | null {
  return PRICES_CONFIRMED ? SETUP_FEE : null;
}
