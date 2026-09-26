/**
 * Turns an error response from the server into a sentence in the user's
 * language.
 *
 * The server sends a stable `code` and the `params` its sentence needs (see
 * backend/app/errors.py); the sentence itself lives in the message catalogs
 * under "errors.<code>". The server's English `detail` is only the last
 * resort, for a code this build does not know yet (a server newer than the
 * interface).
 */

import { enumLabel, getActiveLanguage, hasMessage, t } from "@/lib/i18n";

type FieldError = {
  field?: string;
  code?: string;
  message?: string;
  params?: Record<string, unknown>;
};

export type ApiErrorBody = {
  detail?: unknown;
  code?: string;
  params?: Record<string, unknown>;
  errors?: FieldError[];
};

// The server names statuses by their code ("CANCELLED"); readers get the word.
const STATUS_PARAMS = new Set(["status", "from_status", "to_status"]);

function translateParams(params: Record<string, unknown> | undefined) {
  const out: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === "number") {
      out[key] = value;
    } else if (typeof value === "string" && STATUS_PARAMS.has(key)) {
      // Mid-sentence, so lower case: "a cancelled reservation".
      out[key] = enumLabel("reservationStatus", value).toLocaleLowerCase(
        getActiveLanguage() === "pseudo" ? "en" : getActiveLanguage(),
      );
    } else if (value !== null && value !== undefined) {
      out[key] = String(value);
    }
  }

  // A reason that is itself a coded error ("identity check incomplete:
  // <reason>") is translated in turn.
  if (typeof params?.problem_code === "string") {
    out.problem = codedText(params.problem_code, {}, "");
  }

  return out;
}

function codedText(
  code: string,
  params: Record<string, unknown> | undefined,
  fallback: string,
): string {
  const key = `errors.${code}`;

  return hasMessage(key) ? t(key, translateParams(params)) : fallback;
}

/**
 * The sentence for an error body. `fallbackKey` is what to say when the
 * server sent nothing usable (an empty body, a network proxy's HTML page).
 */
export function errorText(
  body: ApiErrorBody | null | undefined,
  fallbackKey = "errors.generic.failed",
): string {
  if (body?.code === "validation.failed" && body.errors?.length) {
    // The first thing wrong is the most useful thing to show in one line.
    const first = body.errors[0];
    const known = first.code ? codedText(first.code, first.params, "") : "";

    return known || first.message || t("errors.validation.failed");
  }

  if (body?.code) {
    const detail = typeof body.detail === "string" ? body.detail : "";
    const text = codedText(body.code, body.params, detail);

    if (text) return text;
  }

  if (typeof body?.detail === "string" && body.detail) return body.detail;

  return t(fallbackKey);
}

/** Reads the body of a failed response and throws its message. */
export async function throwApiError(
  response: Response,
  fallbackKey = "errors.generic.failed",
): Promise<never> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;

  throw new Error(errorText(body, fallbackKey));
}
