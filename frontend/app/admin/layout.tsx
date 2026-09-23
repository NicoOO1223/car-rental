"use client";

import { useEffect } from "react";

import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useNavigate } from "@/lib/useNavigate";

// UX only — every /admin sub-page's own API calls are independently
// gated server-side by require_role("admin"); this just keeps a staff
// user from landing on a page that would only 403 underneath them.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) {
      navigate("/");
    }
  }, [loading, user, navigate]);

  if (loading || !user || user.role !== "admin") {
    return <div className="min-h-screen bg-canvas" />;
  }

  return <>{children}</>;
}
