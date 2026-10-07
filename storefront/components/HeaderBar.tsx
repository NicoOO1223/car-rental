"use client";

import { CalendarCheck, Car, ChevronDown, LogOut, Menu as MenuIcon, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { useTranslations } from "use-intl";

import { LanguagePicker } from "@/components/LanguagePicker";
import { Menu } from "@/components/Menu";
import { accountApi } from "@/lib/account";

type HeaderAccount = { first_name: string } | null;

/**
 * The top bar. On the home page it floats transparent over the photo and
 * scrolls away with it (the booking bar takes over the top of the screen);
 * everywhere else it is a plain white bar.
 */
export function HeaderBar({
  language,
  businessName,
  logo,
  bookingEnabled,
  account,
}: {
  language: string;
  businessName: string;
  logo: string | null;
  bookingEnabled: boolean;
  account: HeaderAccount;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const overHero = pathname === `/${language}`;
  // Signed in: bookings live on the account. Guests look one up.
  const manageHref = account ? `/${language}/account` : `/${language}/manage`;

  const link = overHero
    ? "text-white/90 hover:text-white"
    : "text-ink-secondary hover:text-ink";
  const itemClass = `flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-current ${link}`;

  async function logout() {
    await accountApi.logout().catch(() => undefined);
    router.push(`/${language}`);
    router.refresh();
  }

  const authLinks = account ? (
    <Menu
      label={t("accountMenu")}
      triggerClassName={`${itemClass}`}
      trigger={
        <>
          <User className="h-4 w-4" aria-hidden="true" />
          <span className="max-w-32 truncate">{account.first_name}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </>
      }
    >
      <Link href={`/${language}/account`} className="flex items-center gap-2 px-4 py-2 hover:bg-surface-sunken">
        <CalendarCheck className="h-4 w-4" aria-hidden="true" />
        {t("myBookings")}
      </Link>
      <button type="button" onClick={logout} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-surface-sunken">
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {t("logout")}
      </button>
    </Menu>
  ) : (
    <div className="flex items-center text-sm font-medium">
      <Link href={`/${language}/login`} className={`rounded-lg px-2.5 py-2 ${link}`}>
        {t("login")}
      </Link>
      <span aria-hidden="true" className={overHero ? "text-white/40" : "text-border-strong"}>
        |
      </span>
      <Link href={`/${language}/register`} className={`rounded-lg px-2.5 py-2 ${link}`}>
        {t("register")}
      </Link>
    </div>
  );

  return (
    <header
      className={
        overHero
          ? "absolute inset-x-0 top-0 z-30 text-white"
          : "relative z-30 border-b border-border-subtle bg-surface text-ink"
      }
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={`/${language}`} className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          {logo && (
            // The logo is an image the business uploaded, served by its own API.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-9 w-9 rounded object-contain" />
          )}
          {businessName}
        </Link>

        {/* Wide screens: everything in one row. */}
        <nav aria-label={businessName} className="hidden items-center gap-1 md:flex">
          {bookingEnabled && (
            <>
              <Link href={manageHref} className={itemClass}>
                <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                {t("manage")}
              </Link>
              <Link href={`/${language}/fleet`} className={itemClass}>
                <Car className="h-4 w-4" aria-hidden="true" />
                {t("fleet")}
              </Link>
            </>
          )}

          <Suspense fallback={null}>
            <LanguagePicker current={language} className={link} />
          </Suspense>

          {bookingEnabled && <span className="mx-2 h-5 w-px bg-current opacity-25" aria-hidden="true" />}
          {bookingEnabled && authLinks}
        </nav>

        <button
          type="button"
          aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
          className="rounded-lg p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-current md:hidden"
        >
          {mobileOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <MenuIcon className="h-6 w-6" aria-hidden="true" />}
        </button>
      </div>

      {/* Small screens: the same links in a panel under the bar. */}
      {mobileOpen && (
        <div
          className="mx-4 mb-3 space-y-1 rounded-xl border border-border-subtle bg-surface p-3 text-ink shadow-lg md:hidden"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a,button")) setMobileOpen(false);
          }}
        >
          {bookingEnabled && (
            <>
              <Link href={manageHref} className="flex items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-surface-sunken">
                <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                {t("manage")}
              </Link>
              <Link href={`/${language}/fleet`} className="flex items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-surface-sunken">
                <Car className="h-4 w-4" aria-hidden="true" />
                {t("fleet")}
              </Link>
              {account ? (
                <>
                  <Link href={`/${language}/account`} className="flex items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-surface-sunken">
                    <User className="h-4 w-4" aria-hidden="true" />
                    {t("myBookings")}
                  </Link>
                  <button
                    type="button"
                    onClick={logout}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-surface-sunken"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {t("logout")}
                  </button>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Link href={`/${language}/login`} className="rounded-lg border border-border-strong px-3 py-2.5 text-center text-sm font-medium">
                    {t("login")}
                  </Link>
                  <Link href={`/${language}/register`} className="rounded-lg bg-accent px-3 py-2.5 text-center text-sm font-medium text-on-accent">
                    {t("register")}
                  </Link>
                </div>
              )}
            </>
          )}

          <div className="border-t border-border-subtle pt-2">
            <Suspense fallback={null}>
              <LanguagePicker current={language} />
            </Suspense>
          </div>
        </div>
      )}
    </header>
  );
}
