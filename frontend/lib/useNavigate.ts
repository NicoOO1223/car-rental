"use client";

import { useRouter } from "next/navigation";

import { useNavigationProgress } from "@/components/NavigationProgress";

// Replaces the window.location.href = "..." pattern used throughout this
// app — that triggers a full browser page reload (re-downloading the JS
// bundle) instead of Next's instant client-side transition. isPending
// (from useTransition, via the shared NavigationProgress context) drives
// the top progress bar so a slow transition still gives visible feedback.
export function useNavigate() {
  const router = useRouter();
  const { navigate } = useNavigationProgress();

  return (href: string) => navigate(() => router.push(href));
}
