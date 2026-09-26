import { ApiFailure } from "@/lib/client";

type Translate = {
  (key: string, values?: Record<string, string | number | Date>): string;
  has: (key: string) => boolean;
};

/**
 * A failure in words the visitor can read, in their language. The API sends a
 * stable code and the values for the sentence; the words are ours. A code we
 * have no wording for falls back to the API English sentence, and anything that
 * is not an API answer to a generic message.
 */
export function errorMessage(t: Translate, error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.code === "network") return t("errors.network");

    const key = `errors.${error.code}`;

    if (t.has(key)) {
      const values: Record<string, string | number> = {};

      for (const [name, value] of Object.entries(error.params)) {
        if (typeof value === "string" || typeof value === "number") values[name] = value;
      }

      return t(key, values);
    }

    if (error.status === 429) return t("errors.public.rate_limited", { seconds: 60 });

    return error.message || t("errors.generic");
  }

  return t("errors.generic");
}
