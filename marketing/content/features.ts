import type { ScreenId } from "./screens";

// The six feature blocks, in page order. Copy lives in messages/en.json under
// `features.<id>`; `bullets` is how many of b1..bN that block has. Each bullet
// must be backed by shipped code (design brief, section 4). `screen` is the
// main picture, `more` up to two smaller supporting ones.

export type Feature = { id: string; screen: ScreenId; more?: readonly ScreenId[]; bullets: number };

export const features: readonly Feature[] = [
  { id: "booking", screen: "storefront", bullets: 3 },
  { id: "counter", screen: "handover", more: ["wizard", "checkout"], bullets: 4 },
  { id: "fleet", screen: "fleet", more: ["classes", "reservation"], bullets: 4 },
  { id: "money", screen: "revenue", bullets: 4 },
  { id: "emails", screen: "email", bullets: 3 },
  { id: "control", screen: "audit", bullets: 4 },
];
