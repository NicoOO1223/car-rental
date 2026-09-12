"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Car,
  CalendarClock,
  FileSignature,
  LayoutDashboard,
  Menu,
  Plus,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

const navigation: { name: string; href: string; icon: LucideIcon }[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Reservations", href: "/reservations/manage", icon: CalendarClock },
  { name: "Finalize Rentals", href: "/reservations/finalize", icon: FileSignature },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Fleet", href: "/cars", icon: Car },
  { name: "Maintenance", href: "/maintenance", icon: Wrench },
];

function SidebarContent({
  pathname,
  onNavigate,
  onClose,
}: {
  pathname: string;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between border-b px-6 py-5">
        <div>
          <h1 className="text-xl font-bold">Car Rental</h1>
          <p className="mt-1 text-xs text-gray-500">Management Panel</p>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-2 -mt-1 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <Link
          href="/reservations"
          onClick={onNavigate}
          className="flex items-center justify-center gap-2 rounded-lg bg-black px-3 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
        >
          <Plus className="h-4 w-4" />
          New Reservation
        </Link>

        <p className="mt-6 px-3 pb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Navigation
        </p>
        <div className="space-y-1">
          {navigation.map((item) => {
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t px-6 py-4">
        <p className="text-xs text-gray-400">Fleet Management</p>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer whenever the route actually changes (covers
  // back/forward navigation too, not just clicking a link) — adjusting
  // state during render on a prop change, per React's own guidance,
  // rather than an effect that would just cause an extra render pass.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  // Lock body scroll while the mobile drawer is open, same as Modal.
  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  return (
    <>
      {/* Mobile top bar — only the sidebar's stand-in below the lg
          breakpoint; the real sidebar (below) takes over at lg and up. */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b bg-white px-4 py-3 lg:hidden">
        <h1 className="text-lg font-bold">Car Rental</h1>

        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />

          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            <SidebarContent
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-white lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent pathname={pathname} />
        </div>
      </aside>
    </>
  );
}
