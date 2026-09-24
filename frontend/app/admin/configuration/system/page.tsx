"use client";

import { ConfigSectionForm } from "@/components/admin/ConfigSectionForm";

export default function SystemConfigurationPage() {
  return (
    <ConfigSectionForm
      title="System"
      description="Not a charge, but part of how the app runs."
      fields={[
        {
          key: "access_token_expire_days",
          label: "Staff session length (days)",
          kind: "integer",
          min: 1,
          hint: "A staff member's login token is valid for this many days. Changing this only affects sessions started after the change — it does not shorten or extend a session already in progress.",
        },
      ]}
    />
  );
}
