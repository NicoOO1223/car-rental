"use client";

import { useEffect, useState, type ReactNode } from "react";

import { getPublicConfiguration } from "@/lib/api";
import { setDefaultCurrency } from "@/lib/format";

/**
 * Loads the business currency once per session and hands it to
 * lib/format.ts. Children render straight away (in EUR until it arrives)
 * and re-render, via the changed key, once the real currency is known.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState("EUR");

  useEffect(() => {
    let cancelled = false;

    getPublicConfiguration()
      .then(({ default_currency }) => {
        if (cancelled) return;

        setDefaultCurrency(default_currency);
        setCurrency(default_currency.toUpperCase());
      })
      // Falling back to EUR is harmless; a 401 is handled globally.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return <div key={currency} className="contents">{children}</div>;
}
