"use client";

import { useEffect, useState, type ReactNode } from "react";

import { getPublicConfiguration } from "@/lib/api";
import {
  setBusinessTimeZone,
  setDefaultCurrency,
  setLocale,
} from "@/lib/format";

/**
 * Loads how this business writes money, dates and times, once per session,
 * and hands it to lib/format.ts: the currency, the formatting locale and the
 * business timezone.
 *
 * Children render straight away with neutral defaults and are remounted,
 * via the changed key, once the real values are known. Remounting (not just
 * re-rendering) matters because pages compute things like "today" when they
 * first mount, and those must be redone in the business's timezone.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [settingsKey, setSettingsKey] = useState("");

  useEffect(() => {
    let cancelled = false;

    getPublicConfiguration()
      .then(({ default_currency, locale, timezone }) => {
        if (cancelled) return;

        setDefaultCurrency(default_currency);
        setLocale(locale);
        setBusinessTimeZone(timezone);
        setSettingsKey(`${default_currency}|${locale}|${timezone}`);
      })
      // Falling back to the defaults is harmless; a 401 is handled globally.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return <div key={settingsKey} className="contents">{children}</div>;
}
