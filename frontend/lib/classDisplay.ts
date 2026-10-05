import type { ClassText } from "@/lib/api";
import { getActiveLanguage } from "@/lib/i18n";

/** A class's words in the language staff use, falling back to English (always present). */
export function classWords(text: ClassText | null | undefined): string {
  if (!text) return "";

  return text[getActiveLanguage()] || text.en || Object.values(text)[0] || "";
}
