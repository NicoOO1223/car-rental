"use client";

import { ConfigSectionForm } from "@/components/admin/ConfigSectionForm";
import { t } from "@/lib/i18n";

export default function DepositConfigurationPage() {
  return (
    <ConfigSectionForm
      title={t("s.admin.configuration.deposit.securityDeposit")}
      description={t("s.admin.configuration.deposit.takenAtCheckBy")}
      fields={[
        {
          key: "security_deposit_amount",
          label: t("s.admin.configuration.deposit.depositAmount"),
          kind: "money",
          hint: t("s.admin.configuration.deposit.set0TurnDeposits"),
        },
      ]}
    />
  );
}
