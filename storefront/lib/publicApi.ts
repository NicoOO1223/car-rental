import type { PublicConfig, PublicLocation, PublicVehicle } from "@shared/publicApi";

import { runtimeConfig } from "@/lib/runtime";

// A backend that has scaled to zero (the demo stack runs with no minimum
// replicas to save cost) takes a while to answer its first request again —
// tens of seconds, not one or two. A short timeout here would read that as
// "the API is down" and show visitors the wrong page for something that is
// just warming up, so this waits long enough to cover a cold start. A stack
// that expects real visitor traffic should give its backend a minimum of
// one replica instead (see deploy/PROVISIONING.md), so this is never hit.
const REQUEST_TIMEOUT_MS = 25_000;

async function get<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${runtimeConfig().apiUrl}/api/public${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * The business public settings, or null when the API cannot be reached (the
 * page then says booking is unavailable instead of failing).
 */
export const getPublicConfig = () => get<PublicConfig>("/config");

export const getLocations = () => get<PublicLocation[]>("/locations");

export const getFleet = () => get<PublicVehicle[]>("/fleet");

export type PublicLegal = {
  legal_version: number;
  terms_text: string;
  terms_url: string;
  privacy_text: string;
  privacy_url: string;
};

export const getLegal = () => get<PublicLegal>("/legal");
