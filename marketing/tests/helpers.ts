import en from "@/messages/en.json";

/** Every message in the English catalogue as dotted-key to text. */
export function flatten(object: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value as Record<string, unknown>, path));
  }

  return out;
}

export const messages = flatten(en);
