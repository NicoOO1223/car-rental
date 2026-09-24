"use client";

import { ConfigSectionForm } from "@/components/admin/ConfigSectionForm";

export default function ReturnChargesConfigurationPage() {
  return (
    <ConfigSectionForm
      title="Return charges"
      description="Charged at check-out when a car comes back late, short of fuel, or damaged."
      fields={[
        {
          key: "late_return_grace_minutes",
          label: "Late return grace period (minutes)",
          kind: "integer",
          hint: "A return no later than this after the scheduled time is not charged.",
        },
        {
          key: "late_fee_per_hour",
          label: "Late fee per started hour",
          kind: "money",
          hint: "Once past the grace period, every started hour late (counted from the scheduled return) is charged.",
        },
        {
          key: "fuel_fee_per_eighth",
          label: "Fuel fee per missing eighth of a tank",
          kind: "money",
          hint: "Cars are handed out with a full tank.",
        },
        {
          key: "refuel_service_fee",
          label: "Refuelling service fee",
          kind: "money",
          hint: "Added once when the car comes back with any fuel missing.",
        },
        {
          key: "max_damage_charge",
          label: "Maximum damage charge",
          kind: "money",
          hint: "The most an employee can charge for damage at check-out.",
        },
      ]}
    />
  );
}
