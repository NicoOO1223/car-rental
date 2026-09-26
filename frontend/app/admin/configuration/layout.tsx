"use client";

import { usePathname } from "next/navigation";

import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { SubNav } from "@/components/ui/SubNav";
import { t } from "@/lib/i18n";

// Every cost and price the business charges, one section per kind. Each
// section is its own route so it can be linked to and reloaded.
const SECTIONS = [
  { id: "business", get label() { return t("s.admin.configuration.layout.business"); }, href: "/admin/configuration/business" },
  { id: "locations", get label() { return t("s.admin.configuration.layout.locations"); }, href: "/admin/configuration/locations" },
  { id: "pricing", get label() { return t("s.admin.configuration.layout.generalPricing"); }, href: "/admin/configuration/pricing" },
  { id: "extras", get label() { return t("s.admin.configuration.layout.extras"); }, href: "/admin/configuration/extras" },
  { id: "vehicles", get label() { return t("s.admin.configuration.layout.vehicleRates"); }, href: "/admin/configuration/vehicles" },
  { id: "returns", get label() { return t("s.admin.configuration.layout.returnCharges"); }, href: "/admin/configuration/returns" },
  { id: "deposit", get label() { return t("s.admin.configuration.layout.securityDeposit"); }, href: "/admin/configuration/deposit" },
  { id: "system", get label() { return t("s.admin.configuration.layout.system"); }, href: "/admin/configuration/system" },
];

export default function ConfigurationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active =
    SECTIONS.find((section) => pathname.startsWith(section.href))?.id ??
    SECTIONS[0].id;

  return (
    <PageShell width="wide">
      <PageHeader
        title={t("s.admin.configuration.layout.configuration")}
        description={t("s.admin.configuration.layout.whoBusinessPricesIt")}
      />

      <SubNav
        label={t("s.admin.configuration.layout.configurationSections")}
        items={SECTIONS}
        activeId={active}
        className="mb-6"
      />

      <div className="max-w-3xl space-y-6">{children}</div>
    </PageShell>
  );
}
