"use client";

import { useEffect, useState } from "react";

/**
 * A value that only updates once it has stopped changing for `delayMs`.
 * Used for search boxes that query the server, so typing "smith" sends one
 * request instead of five.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
