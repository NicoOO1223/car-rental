import type { PublicConfig, PublicLocation, PublicVehicle } from "@shared/publicApi";

import { runtimeConfig } from "@/lib/runtime";

async function get<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${runtimeConfig().apiUrl}/api/public${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
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
