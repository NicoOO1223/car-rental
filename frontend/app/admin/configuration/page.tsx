"use client";

import { useEffect } from "react";

import { useCurrentUser } from "@/components/CurrentUserProvider";
import { firstConfigurationPage } from "@/lib/permissions";
import { useNavigate } from "@/lib/useNavigate";

// Administrators open on pricing; a manager only has the vehicle and extras sections.
export default function ConfigurationIndexPage() {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate(user.role === "admin" ? "/admin/configuration/pricing" : firstConfigurationPage(user.role));
    }
  }, [loading, user, navigate]);

  return null;
}
