// What the page must never say, because the product does not do it (or not
// yet). tests/claims.test.ts scans messages/en.json against these patterns.
// Each entry names what is missing, so a failing test explains itself.

export type Forbidden = { pattern: RegExp; reason: string; allowedIn?: string[] };

export const NOT_CLAIMED: readonly Forbidden[] = [
  { pattern: /\bscooters?\b|\bmotorbikes?\b|\bmotorcycles?\b/i, reason: "No scooter or motorbike category exists; vehicles are cars, SUVs and vans." },
  { pattern: /\bsms\b|\btext messages?\b/i, reason: "SMS is not built." },
  { pattern: /\bscan(s|ning|ned)?\b|\bocr\b/i, reason: "ID and licence details are typed in; nothing is scanned." },
  { pattern: /\b(your|own) (web )?(address|domain)\b/i, reason: "Custom domains are not automated." },
  { pattern: /\boverdue\b/i, reason: "There is no overdue-return reminder." },
  { pattern: /\b(sdi|ksef)\b/i, reason: "E-invoicing is not built; only the FAQ may say so.", allowedIn: ["faq.a8"] },
  { pattern: /\b(mobile|ios|android) app\b/i, reason: "There is no native app." },
  { pattern: /\btestimonials?\b|\btrusted by\b|\baward\b|\brated\b/i, reason: "No customers to quote and no awards." },
  { pattern: /\b\d[\d,.]*\+?\s+(customers|operators|renters|businesses|companies)\b/i, reason: "No customer counts exist." },
  { pattern: /\b(seamless|revolutionary|all-in-one|ai-powered|supercharge|enterprise-grade)\b/i, reason: "Hype words the voice guidelines forbid." },
  { pattern: /\bmost (chosen|popular|loved)\b|\bpopular\b|\bbest[- ]selling\b|\bbest value\b/i, reason: "No customers exist, so nothing can be called popular or most chosen." },
  { pattern: /\bprofit\b|\bcost reports?\b/i, reason: "There is no cost or profit report." },
];
