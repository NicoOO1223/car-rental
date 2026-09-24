"use client";

import { ConfigSectionForm } from "@/components/admin/ConfigSectionForm";

export default function PricingConfigurationPage() {
  return (
    <ConfigSectionForm
      title="General pricing"
      description="Surcharges added on top of the vehicle's daily rate, and the currency everything is charged in."
      fields={[
        {
          key: "short_term_threshold_days",
          label: "Short-term rental threshold (days)",
          kind: "integer",
          min: 1,
          hint: "Rentals shorter than this many days incur the short-term fee below.",
        },
        { key: "short_term_fee", label: "Short-term fee", kind: "money" },
        {
          key: "airport_change_fee",
          label: "Airport change fee",
          kind: "money",
          hint: "Applied when the pickup and return locations differ.",
        },
        {
          key: "default_currency",
          label: "Default currency",
          kind: "currency",
          hint: "3-letter code, e.g. eur.",
        },
      ]}
    />
  );
}
