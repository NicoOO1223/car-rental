"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { getCurrentUser, type CurrentUser } from "@/lib/api";

type CurrentUserContextValue = {
  user: CurrentUser | null;
  loading: boolean;
};

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

// Mounted once AuthGuard has confirmed a token is present, so there is
// always something to fetch. One GET /api/auth/me per session, shared by
// the Sidebar's admin nav section and the /admin route guard.
export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getCurrentUser()
      .then((result) => {
        if (!cancelled) setUser(result);
      })
      // A failure here (e.g. a 401) is already handled globally by
      // apiFetch, which redirects to /login — nothing more to do.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CurrentUserContext.Provider value={{ user, loading }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser() {
  const context = useContext(CurrentUserContext);

  if (!context) {
    throw new Error("useCurrentUser must be used within a CurrentUserProvider");
  }

  return context;
}
