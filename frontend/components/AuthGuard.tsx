"use client";

import { usePathname } from "next/navigation";

import { CurrencyProvider } from "@/components/CurrencyProvider";
import { CurrentUserProvider } from "@/components/CurrentUserProvider";
import { NotificationsProvider } from "@/components/NotificationsProvider";
import Sidebar from "@/components/Sidebar";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { can } from "@/lib/permissions";
import { t } from "@/lib/i18n";

// Owns whether the Sidebar renders at all — /login is a full-screen page with
// no nav, and that decision lives here rather than being duplicated across
// layout and this file.
//
// Keeping signed-out visitors out is not done here: the session is an httpOnly
// cookie a script cannot see, so proxy.ts redirects before any page renders, and
// apiFetch sends anyone whose session has ended (a 401) back to /login.
// Lets someone with a view-only account know why nothing can be changed.
function ReadOnlyBanner() {
  const { user } = useCurrentUser();

  if (!user || can(user.role, "bookings.write")) return null;

  return (
    <p role="status" className="border-b border-warning-line bg-warning-soft px-4 py-2 text-sm text-warning">
      {t("c.AuthGuard.readOnlyBanner")}
    </p>
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <CurrentUserProvider>
      <CurrencyProvider>
      <NotificationsProvider>
      <div className="flex min-h-screen flex-col lg:flex-row">
        {/* Lets a keyboard user jump past the whole nav, which is otherwise
            six links and a button before every page's first control. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[110] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-accent"
        >{t("c.AuthGuard.skipContent")}</a>

        <Sidebar />

        <div id="main-content" className="min-w-0 flex-1">
          <ReadOnlyBanner />
          {children}
        </div>
      </div>
      </NotificationsProvider>
      </CurrencyProvider>
    </CurrentUserProvider>
  );
}
