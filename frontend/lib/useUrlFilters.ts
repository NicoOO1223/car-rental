"use client";

import { useCallback, useMemo } from "react";
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
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
