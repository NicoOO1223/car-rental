"use client";

import { ConfigSectionForm } from "@/components/admin/ConfigSectionForm";
import { t } from "@/lib/i18n";

export default function PricingConfigurationPage() {
  return (
    <ConfigSectionForm
      title={t("s.admin.configuration.pricing.generalPricing")}
      description={t("s.admin.configuration.pricing.surchargesAddedTopVehicle")}
      fields={[
        {
          key: "short_term_threshold_days",
          label: t("s.admin.configuration.pricing.shortTermRentalThreshold"),
          kind: "integer",
          min: 1,
          hint: t("s.admin.configuration.pricing.rentalsShorterThanMany"),
        },
        { key: "short_term_fee", label: t("s.admin.configuration.pricing.shortTermFee"), kind: "money" },
        {
          key: "airport_change_fee",
          label: t("s.admin.configuration.pricing.airportChangeFee"),
          kind: "money",
          hint: t("s.admin.configuration.pricing.appliedWhenPickupReturn"),
        },
        {
          key: "default_currency",
          label: t("s.admin.configuration.pricing.defaultCurrency"),
          kind: "currency",
          hint: t("s.admin.configuration.pricing.3LetterCodeE"),
        },
      ]}
    />
  );
}
