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

import { brandingLandingAboutImageUrl, brandingLandingHeroUrl, brandingLogoUrl, getBranding } from "@/lib/api";

type Brand = {
  /** Empty until the first response arrives. */
  name: string;
  logoUrl: string | null;
  /** The storefront landing page's hero photo, if one is uploaded. */
  heroImageUrl: string | null;
  /** The storefront landing page's About section photo, if one is uploaded. */
  aboutImageUrl: string | null;
  /** The interface language for someone who has not chosen their own. */
  defaultLanguage: string;
  /** True once the branding call has answered, or failed. */
  loaded: boolean;
  /** Re-reads the branding, e.g. after the admin saves the business page. */
  refresh: () => void;
};

const BrandContext = createContext<Brand>({
  name: "",
  logoUrl: null,
  heroImageUrl: null,
  aboutImageUrl: null,
  defaultLanguage: "en",
  loaded: false,
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
    heroImageUrl: string | null;
    aboutImageUrl: string | null;
    defaultLanguage: string;
    loaded: boolean;
  }>({ name: "", logoUrl: null, heroImageUrl: null, aboutImageUrl: null, defaultLanguage: "en", loaded: false });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getBranding()
      .then((result) => {
        if (cancelled) return;

        setBranding({
          name: result.business_name,
          logoUrl: result.has_logo ? brandingLogoUrl(result.logo_version) : null,
          heroImageUrl: result.has_hero_image ? brandingLandingHeroUrl(result.hero_image_version) : null,
          aboutImageUrl: result.has_landing_about_image
            ? brandingLandingAboutImageUrl(result.landing_about_image_version)
            : null,
          defaultLanguage: result.default_language,
          loaded: true,
        });
      })
      // Branding is cosmetic; the app works without it. The language still
      // needs to know the call is over so it can fall back to English.
      .catch(() => setBranding((current) => ({ ...current, loaded: true })));

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
