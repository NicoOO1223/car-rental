"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { brandingLogoUrl, getBranding } from "@/lib/api";

type Brand = {
  /** Empty until the first response arrives. */
  name: string;
  logoUrl: string | null;
  /** Re-reads the branding, e.g. after the admin saves the business page. */
  refresh: () => void;
};

const BrandContext = createContext<Brand>({
  name: "",
  logoUrl: null,
  refresh: () => {},
});

/**
 * The business's name and logo, read once from the public branding
 * endpoint (it works on the login page, before anyone is signed in).
 * Nothing here falls back to a hardcoded business name: until the answer
 * arrives the name is simply empty, so one customer's stack never briefly
 * shows another's brand.
 */
export function BrandProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<{
    name: string;
    logoUrl: string | null;
  }>({ name: "", logoUrl: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getBranding()
      .then((result) => {
        if (cancelled) return;

        setBranding({
          name: result.business_name,
          logoUrl: result.has_logo ? brandingLogoUrl(result.logo_version) : null,
        });
      })
      // Branding is cosmetic; the app works without it.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  const value = useMemo(() => ({ ...branding, refresh }), [branding, refresh]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext);
}

/** "Island Cars" -> "IC", "Wheels" -> "W". */
export function brandInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return letters || "·";
}
