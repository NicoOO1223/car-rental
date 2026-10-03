import { storefrontConfigFromEnv, type StorefrontRuntimeConfig } from "@shared/runtimeConfig";

/** This stack's settings, read from the container environment on each call. */
export function runtimeConfig(): StorefrontRuntimeConfig {
  return storefrontConfigFromEnv(process.env);
}

/** A representative photo for this offer — PublicVehicle carries no car id
 * (see its docstring), only this same opaque key already used to group
 * identical cars and to book one. Public and unauthenticated, the same way
 * the business logo and the landing page's hero/about images are served. */
export function carPhotoUrl(offerKey: string, version: number | null): string {
  return `${runtimeConfig().apiUrl}/api/public/offers/${offerKey}/photo${version ? `?v=${version}` : ""}`;
}
