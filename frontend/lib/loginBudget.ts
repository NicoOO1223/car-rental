/**
 * How many wrong sign-ins one visitor gets before this app stops forwarding
 * them to the API for a while.
 *
 * The API has its own limits, but when it cannot tell visitors apart (no shared
 * secret configured) it counts everyone together, so one person guessing
 * passwords could use the whole budget and lock everybody out. Stopping them
 * here keeps their attempts from reaching that shared count. In memory, per
 * instance: it only has to blunt guessing, and the account lockout in the API
 * is the real limit.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_VISITORS = 5000;

const failures = new Map<string, number[]>();

function recent(visitor: string, now: number): number[] {
  const kept = (failures.get(visitor) ?? []).filter((at) => now - at < WINDOW_MS);

  if (kept.length) failures.set(visitor, kept);
  else failures.delete(visitor);

  return kept;
}

/** Whether this visitor has used up their wrong attempts. */
export function isBlocked(visitor: string, now: number = Date.now()): boolean {
  return visitor !== "" && recent(visitor, now).length >= MAX_FAILURES;
}

export function recordFailure(visitor: string, now: number = Date.now()): void {
  if (visitor === "") return;

  // A flood from many addresses must not grow this without bound.
  if (failures.size >= MAX_VISITORS && !failures.has(visitor)) {
    failures.delete(failures.keys().next().value as string);
  }

  failures.set(visitor, [...recent(visitor, now), now]);
}

export function resetLoginBudget(): void {
  failures.clear();
}

export const LOGIN_RETRY_AFTER_SECONDS = WINDOW_MS / 1000;
