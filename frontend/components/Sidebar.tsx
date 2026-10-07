"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Bell,
  Car,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserCog,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { logout } from "@/lib/api";
import { can, canOpenAdminPage } from "@/lib/permissions";

import { BrandMark } from "@/components/BrandMark";
import { LanguagePicker } from "@/components/LanguagePicker";
import { useBrand } from "@/components/BrandProvider";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useNotifications } from "@/components/NotificationsProvider";
import { t } from "@/lib/i18n";

// Names are keys into the "nav" catalog, translated where they are drawn.
type NavItem = { key: string; href: string; icon: LucideIcon };
type NavSection = { labelKey: string | null; items: NavItem[] };

/**
 * Grouped rather than one flat list of six. "Bookings" and "Fleet" are
 * genuinely different jobs, and the labels give the eye somewhere to land
 * when scanning for a destination.
 */
const BASE_NAV_SECTIONS: NavSection[] = [
  {
    labelKey: null,
    items: [
      { key: "overview", href: "/", icon: LayoutDashboard },
      { key: "notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    labelKey: "bookings",
    items: [
      { key: "reservations", href: "/reservations/manage", icon: CalendarClock },
      { key: "handovers", href: "/handovers", icon: ArrowLeftRight },
      { key: "customers", href: "/customers", icon: Users },
    ],
  },
  {
    labelKey: "fleet",
    items: [
      { key: "vehicles", href: "/cars", icon: Car },
      { key: "maintenance", href: "/maintenance", icon: Wrench },
      { key: "fleetCondition", href: "/fleet-condition", icon: ShieldCheck },
    ],
  },
];

// Shown by role (see Sidebar()) — a client-side convenience, not the
// security boundary. Every route/endpoint behind it is independently
// gated server-side.
const ADMIN_NAV_SECTION: NavSection = {
  labelKey: "admin",
  items: [
    { key: "users", href: "/admin/users", icon: UserCog },
    { key: "auditLog", href: "/admin/audit-log", icon: History },
    { key: "revenue", href: "/admin/revenue", icon: TrendingUp },
    { key: "configuration", href: "/admin/configuration", icon: SlidersHorizontal },
  ],
};

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";

/**
 * The collapsed preference lives in localStorage, which does not exist on
 * the server. useSyncExternalStore is React's sanctioned way to read
 * browser-only state without a hydration mismatch — reading it in an
 * effect instead would mean a setState during mount, and reading it in
 * render would differ between server and client.
 */
const collapseListeners = new Set<() => void>();

function subscribeToCollapse(callback: () => void) {
  collapseListeners.add(callback);
  window.addEventListener("storage", callback);

  return () => {
    collapseListeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function getCollapseSnapshot(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true";
  } catch {
    // Private browsing or blocked storage.
    return false;
  }
}

function getCollapseServerSnapshot(): boolean {
  return false;
}

function setStoredCollapse(next: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
  } catch {
    // The preference simply will not persist.
  }

  // localStorage writes do not fire a storage event in the same tab.
  for (const listener of collapseListeners) listener();
}

function isItemActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function SidebarContent({
  pathname,
  collapsed,
  sections,
  onNavigate,
  onClose,
  onToggleCollapse,
  accountEmail,
}: {
  pathname: string;
  collapsed: boolean;
  sections: NavSection[];
  onNavigate?: () => void;
  onClose?: () => void;
  onToggleCollapse?: () => void;
  accountEmail: string | null;
}) {
  const isNewBooking = pathname.startsWith("/reservations/new");
  const { name: brandName } = useBrand();
  const { count: notificationCount, urgent: urgentCount } = useNotifications();
  const { user: signedInUser } = useCurrentUser();
  const canWrite = can(signedInUser?.role, "bookings.write");

  return (
    <div className="flex h-full flex-col bg-surface">
      <div
        className={`flex items-start justify-between border-b border-border-subtle py-5 ${
          collapsed ? "px-3" : "px-5"
        }`}
      >
        {collapsed ? (
          <BrandMark className="mx-auto h-9 w-9" />
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="h-9 w-9" />
            <div className="min-w-0">
              <h1 className="min-h-7 truncate text-lg font-bold tracking-tight text-ink">
                {brandName}
              </h1>
              <p className="mt-0.5 text-xs text-ink-muted">{t("nav.managementPanel")}</p>
            </div>
          </div>
        )}

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("nav.closeMenu")}
            className="-mr-2 -mt-1 rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav
        aria-label={t("nav.main")}
        className={`flex-1 overflow-y-auto py-5 ${collapsed ? "px-2" : "px-3"}`}
      >
        {canWrite && (
        <Link
          href="/reservations/new"
          onClick={onNavigate}
          title={collapsed ? t("nav.newReservation") : undefined}
          aria-current={isNewBooking ? "page" : undefined}
          className={`flex items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-on-accent transition hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 ${
            collapsed ? "px-2" : "px-3"
          } ${isNewBooking ? "ring-2 ring-accent-ink ring-offset-2" : ""}`}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
          {!collapsed && t("nav.newReservation")}
          {collapsed && <span className="sr-only">{t("nav.newReservation")}</span>}
        </Link>
        )}

        {sections.map((section, sectionIndex) => (
          <div key={section.labelKey ?? sectionIndex} className="mt-6">
            {section.labelKey && !collapsed && (
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                {t(`nav.${section.labelKey}`)}
              </p>
            )}

            {section.labelKey && collapsed && (
              <div
                className="mx-2 mb-2 border-t border-border-subtle"
                aria-hidden="true"
              />
            )}

            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isItemActive(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? t(`nav.${item.key}`) : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
                      collapsed ? "justify-center px-2" : "px-3"
                    } ${
                      active
                        ? "bg-surface-sunken text-ink"
                        : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                    }`}
                  >
                    {/* An accent bar as well as the tint, so the current
                        page is obvious rather than a faint gray wash. */}
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent"
                      />
                    )}

                    <item.icon
                      className={`h-4 w-4 shrink-0 ${
                        active ? "text-ink" : "text-ink-muted"
                      }`}
                      aria-hidden="true"
                    />

                    {!collapsed && t(`nav.${item.key}`)}
                    {collapsed && <span className="sr-only">{t(`nav.${item.key}`)}</span>}

                    {item.key === "notifications" && notificationCount > 0 && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-xs font-semibold text-surface ${
                          urgentCount > 0 ? "bg-danger" : "bg-warning-strong"
                        } ${collapsed ? "absolute right-1 top-1 px-1 py-0 text-[10px]" : "ml-auto"}`}
                        aria-label={t("notifications.count", { count: notificationCount })}
                      >
                        {notificationCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div
        className={`border-t border-border-subtle py-4 ${
          collapsed ? "px-2" : "px-5"
        }`}
      >
        {!collapsed && accountEmail && (
          <p className="truncate text-xs text-ink-muted" title={accountEmail}>
            {accountEmail}
          </p>
        )}

        <LanguagePicker compact={collapsed} className="mt-2" />

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              // Ends the session on the server, then reloads onto the
              // login page so no stale authenticated state survives.
              void logout();
            }}
            title={collapsed ? t("nav.signOut") : undefined}
            className={`flex items-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-ink-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
              collapsed ? "mx-auto justify-center px-2" : "px-0"
            }`}
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {!collapsed && t("nav.signOut")}
            {collapsed && <span className="sr-only">{t("nav.signOut")}</span>}
          </button>

          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
              className={`rounded-lg p-1.5 text-ink-muted transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
                collapsed ? "mx-auto" : ""
              }`}
            >
              {collapsed ? (
                <ChevronsRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { name: brandName } = useBrand();
  const { user } = useCurrentUser();

  // Per-employee display preference, configured from /admin/users — not
  // a security boundary. Every route behind a hidden item stays reachable
  // by URL, exactly like the Admin section already is for non-admins.
  const hiddenNavItems = new Set(user?.hidden_nav_items ?? []);
  const visibleBaseSections = BASE_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !hiddenNavItems.has(item.href)),
  })).filter((section) => section.items.length > 0);

  const adminItems = ADMIN_NAV_SECTION.items.filter((item) => canOpenAdminPage(user?.role, item.href));
  const sections =
    adminItems.length > 0
      ? [...visibleBaseSections, { ...ADMIN_NAV_SECTION, items: adminItems }]
      : visibleBaseSections;

  const collapsed = useSyncExternalStore(
    subscribeToCollapse,
    getCollapseSnapshot,
    getCollapseServerSnapshot,
  );

  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  function toggleCollapse() {
    setStoredCollapse(!collapsed);
  }

  // Escape to close and a focus trap, matching Modal. The drawer used to
  // have neither, so keyboard users could tab straight out of an open
  // drawer into the page behind it.
  useEffect(() => {
    if (!mobileOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !drawerRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  return (
    <>
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-border-subtle bg-surface px-4 py-3 lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark className="h-8 w-8" />
          <h1 className="min-h-7 truncate text-lg font-bold tracking-tight text-ink">
            {brandName}
          </h1>
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={t("nav.openMenu")}
          aria-expanded={mobileOpen}
          className="rounded-lg p-2 text-ink-secondary transition hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 animate-[fade-in_0.15s_ease-out]"
            onClick={() => setMobileOpen(false)}
          />

          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.navigation")}
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl animate-[slide-in-left_0.2s_ease-out]"
          >
            <SidebarContent
              pathname={pathname}
              collapsed={false}
              sections={sections}
              accountEmail={user?.email ?? null}
              onNavigate={() => setMobileOpen(false)}
              onClose={() => {
                setMobileOpen(false);
                menuButtonRef.current?.focus();
              }}
            />
          </div>
        </div>
      )}

      <aside
        className={`hidden shrink-0 border-r border-border-subtle lg:block ${
          collapsed ? "w-16" : "w-64"
        } transition-[width] duration-200`}
      >
        <div className="sticky top-0 h-screen">
          <SidebarContent
            pathname={pathname}
            collapsed={collapsed}
            sections={sections}
            accountEmail={user?.email ?? null}
            onToggleCollapse={toggleCollapse}
          />
        </div>
      </aside>
    </>
  );
}
