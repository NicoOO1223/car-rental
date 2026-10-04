"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { useCurrentUser } from "@/components/CurrentUserProvider";
import { canOpenAdminPage } from "@/lib/permissions";
import { useNavigate } from "@/lib/useNavigate";

// UX only — every /admin sub-page's own API calls are independently
// gated server-side (admin only, or the manager permissions in
// backend/app/permissions.py); this just keeps someone from landing on a
// page that would only 403 underneath them.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  const pathname = usePathname();
  const allowed = !!user && canOpenAdminPage(user.role, pathname);

  useEffect(() => {
    if (!loading && !allowed) {
      navigate("/");
    }
  }, [loading, allowed, navigate]);

  if (loading || !allowed) {
    return <div className="min-h-screen bg-canvas" />;
  }

  return <>{children}</>;
}
