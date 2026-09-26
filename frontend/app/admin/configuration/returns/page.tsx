"use client";

import { ConfigSectionForm } from "@/components/admin/ConfigSectionForm";
import { t } from "@/lib/i18n";

export default function ReturnChargesConfigurationPage() {
  return (
    <ConfigSectionForm
      title={t("s.admin.configuration.returns.returnCharges")}
      description={t("s.admin.configuration.returns.chargedAtCheckOut")}
      fields={[
        {
          key: "late_return_grace_minutes",
          label: t("s.admin.configuration.returns.lateReturnGracePeriod"),
          kind: "integer",
          hint: t("s.admin.configuration.returns.returnNoLaterThan"),
        },
        {
          key: "late_fee_per_hour",
          label: t("s.admin.configuration.returns.lateFeePerStarted"),
          kind: "money",
          hint: t("s.admin.configuration.returns.oncePastGracePeriod"),
        },
        {
          key: "fuel_fee_per_eighth",
          label: t("s.admin.configuration.returns.fuelFeePerMissing"),
          kind: "money",
          hint: t("s.admin.configuration.returns.carsHandedOutWith"),
        },
        {
          key: "refuel_service_fee",
          label: t("s.admin.configuration.returns.refuellingServiceFee"),
          kind: "money",
          hint: t("s.admin.configuration.returns.addedOnceWhenCar"),
        },
        {
          key: "max_damage_charge",
          label: t("s.admin.configuration.returns.maximumDamageCharge"),
          kind: "money",
          hint: t("s.admin.configuration.returns.mostEmployeeCanCharge"),
        },
      ]}
    />
  );
}
