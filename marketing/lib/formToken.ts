import { createHmac, timingSafeEqual } from "node:crypto";

// A signed timestamp the form fetches when it opens. It lets the server tell how
// long the form was on screen, so a script that posts within a moment of loading
// is recognised without a visible puzzle. It is a speed bump, not a secret: the
// real checks are Turnstile and the rate limit.

const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function sign(timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(timestamp).digest("hex").slice(0, 32);
}

export function createFormToken(now: number, secret: string): string {
  const timestamp = String(now);

  return `${timestamp}.${sign(timestamp, secret)}`;
}

/** How long ago the token was issued, or null if it is not ours, was altered or is too old. */
export function formTokenAge(token: string, secret: string, now: number): number | null {
  const [timestamp, signature, ...rest] = token.split(".");

  if (!timestamp || !signature || rest.length || !/^\d{10,16}$/.test(timestamp)) return null;

  const expected = Buffer.from(sign(timestamp, secret));
  const given = Buffer.from(signature);

  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const age = now - Number(timestamp);

  return age >= 0 && age <= MAX_AGE_MS ? age : null;
}
