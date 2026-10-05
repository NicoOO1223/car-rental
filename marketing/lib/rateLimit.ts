// A fixed-window limiter in memory, the same idea as backend/app/services/rate_limit.py.
// It is per process: with two replicas a visitor can get twice the budget, which is
// acceptable beside Turnstile, since this only has to stop a flood.

export type Window = { limit: number; windowMs: number };

const MAX_KEYS = 10_000;

export class RateLimiter {
  private hits = new Map<string, number[]>();

  /**
   * Counts a request for `key` against every window. Returns null if it is
   * allowed (and records it), else the seconds to wait. A refused request is
   * not recorded, so waiting out the window always works.
   */
  check(key: string, windows: readonly Window[], now: number): number | null {
    const longest = Math.max(...windows.map((w) => w.windowMs));
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < longest);

    for (const { limit, windowMs } of windows) {
      const inWindow = recent.filter((at) => now - at < windowMs);

      if (inWindow.length >= limit) {
        const oldest = Math.min(...inWindow);

        return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      }
    }

    recent.push(now);
    this.hits.set(key, recent);

    if (this.hits.size > MAX_KEYS) this.sweep(now, longest);

    return null;
  }

  private sweep(now: number, longest: number) {
    for (const [key, times] of this.hits) {
      if (!times.some((at) => now - at < longest)) this.hits.delete(key);
    }

    // Still too many live keys (a flood from many addresses): drop the oldest half.
    if (this.hits.size > MAX_KEYS) {
      let drop = Math.floor(this.hits.size / 2);

      for (const key of this.hits.keys()) {
        if (drop-- <= 0) break;
        this.hits.delete(key);
      }
    }
  }

  reset() {
    this.hits.clear();
  }
}

/** Per address: 5 requests in 10 minutes and 20 in a day. */
export const DEMO_WINDOWS: readonly Window[] = [
  { limit: 5, windowMs: 10 * 60 * 1000 },
  { limit: 20, windowMs: 24 * 60 * 60 * 1000 },
];

export const demoLimiter = new RateLimiter();
