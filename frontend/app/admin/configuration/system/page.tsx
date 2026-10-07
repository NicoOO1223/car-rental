"use client";

import { ConfigSectionForm } from "@/components/admin/ConfigSectionForm";
import { t } from "@/lib/i18n";

export default function SystemConfigurationPage() {
  return (
    <ConfigSectionForm
      title={t("s.admin.configuration.system.system")}
      description={t("s.admin.configuration.system.notChargeButPart")}
      fields={[
        {
          key: "access_token_expire_days",
          label: t("s.admin.configuration.system.staffSessionLengthDays"),
          kind: "integer",
          min: 1,
          hint: t("s.admin.configuration.system.staffMemberSLogin"),
        },
        {
          key: "reminder_days",
          label: t("s.admin.configuration.system.reminderWindowDays"),
          kind: "integer",
          min: 1,
          hint: t("s.admin.configuration.system.reminderWindowHint"),
        },
        {
          key: "confirm_within_hours",
          label: t("s.admin.configuration.system.confirmWithinHours"),
          kind: "integer",
          min: 0,
          hint: t("s.admin.configuration.system.confirmWithinHoursHint"),
        },
        {
          key: "oil_change_interval_km",
          label: t("s.admin.configuration.system.oilChangeIntervalKm"),
          kind: "integer",
          min: 1,
          hint: t("s.admin.configuration.system.oilChangeIntervalKmHint"),
        },
      ]}
    />
  );
}
