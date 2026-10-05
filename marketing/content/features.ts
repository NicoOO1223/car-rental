import type { ScreenId } from "./screens";

// The six feature blocks, in page order. Copy lives in messages/en.json under
// `features.<id>`; `bullets` is how many of b1..bN that block has. Each bullet
// must be backed by shipped code (design brief, section 4).

export type Feature = { id: string; screen: ScreenId; bullets: number };

export const features: readonly Feature[] = [
  { id: "booking", screen: "storefront", bullets: 3 },
  { id: "counter", screen: "handover", bullets: 4 },
  { id: "fleet", screen: "fleet", bullets: 4 },
  { id: "money", screen: "revenue", bullets: 4 },
  { id: "emails", screen: "email", bullets: 3 },
  { id: "control", screen: "audit", bullets: 4 },
];
