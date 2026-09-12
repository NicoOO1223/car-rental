"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { getToken } from "@/lib/api";
import Sidebar from "@/components/Sidebar";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot() {
  return getToken();
}

function getServerSnapshot() {
  return null;
}

// Also owns whether the Sidebar renders at all — /login is a full-screen
// page with no nav, and that decision lives in the same place as the
// auth check rather than being duplicated across layout and this file.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // null on the server and on the client's very first paint before
  // hydration settles, then resolves to the real localStorage value —
  // useSyncExternalStore is the React-sanctioned way to read
  // browser-only state like this without a hydration mismatch.
  const token = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isLoginPage = pathname === "/login";

  // A navigation side-effect, not a state update, so this doesn't need
  // the "adjust state during render" treatment — effects are exactly
  // where side effects like this belong. Reads getToken() directly here
  // rather than trusting the `token` above: useSyncExternalStore forces
  // that value to null for the hydration-matching render even when a
  // real token exists, and effects fire on that same first pass — an
  // effect keyed off `token` would see the transient null and redirect
  // before the following render corrects it. Calling getToken() fresh
  // (effects only run post-hydration, never during SSR/the matching
  // pass) reads the real value the very first time this runs at all.
  useEffect(() => {
    if (!isLoginPage && !getToken()) {
      window.location.href = "/login";
    }
  }, [isLoginPage, token]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  // Blank until a token is confirmed present, so a logged-out visitor
  // never sees a flash of real data before the redirect above fires.
  if (!token) {
    return <div className="min-h-screen bg-gray-50" />;
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar />

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
