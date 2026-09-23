"use client";

import { useEffect } from "react";

import { useNavigate } from "@/lib/useNavigate";

// Sidebar links go straight to the sub-pages; this only catches anyone
// who lands on the bare /admin path directly.
export default function AdminIndexPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/admin/audit-log");
  }, [navigate]);

  return null;
}
