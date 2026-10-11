"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Filter state that lives in the URL instead of in useState.
 *
 * Pass `defaults` as a module-level constant, not an inline object
 * literal: it is a dependency of the memos below, so a fresh object on
 * every render would recompute them every time.
 *
 * Every list page previously held its filters in component state, so a
 * refresh, a back button, or sharing the link all lost the view. Here the
 * URL is the state, which makes those three work for free.
 *
 * Two deliberate details: a filter sitting at its default value is omitted
 * from the query string, so the common case stays a clean URL; and updates
 * use replace rather than push, so nudging a dropdown does not bury the
 * previous page under a pile of history entries.
 *
 * With `persist`, the filters also survive leaving the page: they are kept for
 * the browser session, and a visit that arrives with no filters in its link
 * (the sidebar, the back button from a record) gets them back. A link that
 * carries its own filters wins over what was kept.
 */
export function useUrlFilters<T extends Record<string, string>>(
  defaults: T,
  { persist = false }: { persist?: boolean } = {},
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const storageKey = persist ? `url-filters:${pathname}` : null;
  const restored = useRef(false);
  const restoring = useRef(false);

  useEffect(() => {
    if (!storageKey || restored.current) return;
    restored.current = true;

    if (searchParams.toString() !== "") return;

    try {
      const saved = sessionStorage.getItem(storageKey);

      if (saved) {
        restoring.current = true;
        router.replace(`${pathname}?${saved}`, { scroll: false });
      }
    } catch {
      // Storage can be unavailable; the page then simply opens on its defaults.
    }
  }, [storageKey, pathname, router, searchParams]);

  useEffect(() => {
    if (!storageKey) return;

    const query = searchParams.toString();

    // Until the restored filters arrive in the URL, the empty one must not overwrite them.
    if (restoring.current && query === "") return;
    restoring.current = false;

    try {
      sessionStorage.setItem(storageKey, query);
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  }, [storageKey, searchParams]);

  const filters = useMemo(() => {
    const result = { ...defaults };

    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const value = searchParams.get(String(key));

      if (value !== null) {
        result[key] = value as T[keyof T];
      }
    }

    return result;
  }, [searchParams, defaults]);

  const setFilters = useCallback(
    (patch: Partial<T>) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;

        if (value === defaults[key as keyof T] || value === "") {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }

      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, searchParams, defaults],
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const isFiltered = useMemo(
    () =>
      (Object.keys(defaults) as (keyof T)[]).some(
        (key) => filters[key] !== defaults[key],
      ),
    [filters, defaults],
  );

  return { filters, setFilters, clearFilters, isFiltered };
}
