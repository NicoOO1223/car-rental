import type { PublicConfig } from "@shared/publicApi";

import { runtimeConfig } from "@/lib/runtime";

/**
 * The business public settings, or null when the API cannot be reached (the
 * page then says booking is unavailable instead of failing).
 */
export async function getPublicConfig(): Promise<PublicConfig | null> {
  try {
    const response = await fetch(`${runtimeConfig().apiUrl}/api/public/config`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    return response.ok ? ((await response.json()) as PublicConfig) : null;
  } catch {
    return null;
  }
}
