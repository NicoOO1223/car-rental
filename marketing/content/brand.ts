// The one place the brand lives. Changing the name, the contact details or the
// legal entity is an edit to this file (plus the accent colour in app/globals.css).
//
// EVERYTHING HERE IS A PLACEHOLDER until the owner decides. While `placeholder`
// is true the site is never indexable (lib/site.ts), and `npm run check:launch`
// fails.

const TODO = "TODO";

export const brand = {
  /** Working name only: not checked for domain, trademark or native-speaker feel. */
  name: "Velto",
  /** True until the owner has chosen the real name and domain. */
  placeholder: true,
  domain: TODO,
  /** Where demo requests are answered and shown as the fallback address. */
  contactEmail: TODO,
  legal: {
    entity: TODO,
    address: TODO,
    vatId: TODO,
    country: TODO,
  },
  /** True once a lawyer has approved /privacy and /terms. */
  legalReviewed: false,
};

export type Brand = typeof brand;

export function isTodo(value: string): boolean {
  return value === TODO;
}

/** The legal fields still waiting for the owner. */
export function missingLegalFields(source: Brand = brand): string[] {
  return Object.entries(source.legal)
    .filter(([, value]) => isTodo(value))
    .map(([key]) => `legal.${key}`);
}
