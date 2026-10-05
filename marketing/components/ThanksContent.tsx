"use client";

import { useMemo, useSyncExternalStore } from "react";

type Copy = {
  heading: string; // with {name}
  headingGeneric: string;
  sub: string; // with {email}
  subGeneric: string;
};

const KEY = "demo-thanks";

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    // Storage blocked: the generic wording is fine.
    return null;
  }
}

const subscribe = () => () => {};

// The details come from the form that was just sent (kept in this tab only, never
// in the address), so the page can name the person and the address the copy went
// to. Opened directly, or with storage unavailable, it shows the generic wording.
// The server renders the generic wording; the browser swaps in the details without a hydration mismatch.
export function ThanksContent({ copy }: { copy: Copy }) {
  const raw = useSyncExternalStore(subscribe, read, () => null);

  const remembered = useMemo(() => {
    if (!raw) return null;

    try {
      const value = JSON.parse(raw) as { name?: unknown; email?: unknown };

      return typeof value.name === "string" && typeof value.email === "string" ? { name: value.name, email: value.email } : null;
    } catch {
      return null;
    }
  }, [raw]);

  return (
    <>
      <h1 className="display text-5xl font-bold md:text-6xl">
        {remembered ? copy.heading.replace("{name}", remembered.name) : copy.headingGeneric}
      </h1>
      <p className="mt-4 max-w-xl text-lg text-ink-secondary">
        {remembered ? copy.sub.replace("{email}", remembered.email) : copy.subGeneric}
      </p>
    </>
  );
}
