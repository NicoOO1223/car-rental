import { storefrontConfigFromEnv, type StorefrontRuntimeConfig } from "@shared/runtimeConfig";

/** This stack's settings, read from the container environment on each call. */
export function runtimeConfig(): StorefrontRuntimeConfig {
  return storefrontConfigFromEnv(process.env);
}
