"use client";

import { usePathname } from "next/navigation";

import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { SubNav } from "@/components/ui/SubNav";

// Every cost and price the business charges, one section per kind. Each
// section is its own route so it can be linked to and reloaded.
const SECTIONS = [
  { id: "business", label: "Business", href: "/admin/configuration/business" },
  { id: "pricing", label: "General pricing", href: "/admin/configuration/pricing" },
  { id: "extras", label: "Extras", href: "/admin/configuration/extras" },
  { id: "vehicles", label: "Vehicle rates", href: "/admin/configuration/vehicles" },
  { id: "returns", label: "Return charges", href: "/admin/configuration/returns" },
  { id: "deposit", label: "Security deposit", href: "/admin/configuration/deposit" },
  { id: "system", label: "System", href: "/admin/configuration/system" },
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
        title="Configuration"
        description="Who the business is, the prices it charges, and the rules behind them."
      />

      <SubNav
        label="Configuration sections"
        items={SECTIONS}
        activeId={active}
        className="mb-6"
      />

      <div className="max-w-3xl space-y-6">{children}</div>
    </PageShell>
  );
}
