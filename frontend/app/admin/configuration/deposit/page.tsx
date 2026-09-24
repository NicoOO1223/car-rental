"use client";

import { ConfigSectionForm } from "@/components/admin/ConfigSectionForm";

export default function DepositConfigurationPage() {
  return (
    <ConfigSectionForm
      title="Security deposit"
      description="Taken at check-in by card hold or cash, and required before the rental agreement. At check-out any late, fuel or damage charges are taken from it first and the rest is released."
      fields={[
        {
          key: "security_deposit_amount",
          label: "Deposit amount",
          kind: "money",
          hint: "Set to 0 to turn deposits off. Rentals already checked in keep the deposit they were checked in with.",
        },
      ]}
    />
  );
}
