// The business's brand colour, and the colours derived from it.
//
// A business picks one colour in Configuration > Business. Everything else is
// worked out here so that any choice stays readable: the text put on top of the
// colour, and a version of the colour dark enough to use as text on white.
//
// The storefront has its own copy of this file (storefront/lib/accent.ts); the
// two apps are built separately and share no code at runtime. Keep them the same.

/** Near-black: both apps look monochrome until a business picks a colour. */
export const DEFAULT_ACCENT = "#0a0a0a";

const HEX = /^#[0-9a-f]{6}$/;
const WHITE = "#ffffff";
const INK = "#0a0a0a";

/** WCAG AA for normal text. */
const READABLE = 4.5;

/** A usable "#rrggbb", or the default when the value is missing or malformed. */
export function normalizeAccent(value: string | null | undefined): string {
  const candidate = (value ?? "").trim().toLowerCase();

  return HEX.test(candidate) ? candidate : DEFAULT_ACCENT;
}

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const share = channel / 255;

    return share <= 0.03928 ? share / 12.92 : Math.pow((share + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colours, from 1 (none) to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (light + 0.05) / (dark + 0.05);
}

/** White or near-black, whichever reads better on top of the colour. */
export function onAccent(accent: string): string {
  return contrast(accent, WHITE) >= contrast(accent, INK) ? WHITE : INK;
}

function darken(hex: string, share: number): string {
  const mixed = channels(hex).map((channel) => Math.round(channel * (1 - share)));

  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The colour as text or an icon on a white surface. A pale brand colour (a
 * yellow, a light blue) is darkened step by step until it is readable; a
 * colour that already is stays exactly as chosen.
 */
export function accentInk(accent: string): string {
  let ink = accent;

  for (let step = 1; step <= 20 && contrast(ink, WHITE) < READABLE; step++) {
    ink = darken(accent, step * 0.05);
  }

  return ink;
}

/** The CSS variables to put on the root element for this brand colour. */
export function accentVariables(value: string | null | undefined): Record<string, string> {
  const accent = normalizeAccent(value);

  return {
    "--accent": accent,
    "--on-accent": onAccent(accent),
    "--accent-ink": accentInk(accent),
  };
}

/** Applies the brand colour to the page that is open (after an admin changes it). */
export function applyAccent(value: string | null | undefined): void {
  for (const [name, colour] of Object.entries(accentVariables(value))) {
    document.documentElement.style.setProperty(name, colour);
  }
}
