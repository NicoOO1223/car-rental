import { t } from "@/lib/i18n";

/**
 * The non-admin nav items an admin can hide from an individual
 * employee's sidebar (see components/users/EditUserModal.tsx and
 * components/Sidebar.tsx). "Overview" and the whole Admin section are
 * deliberately excluded — always visible, not configurable.
 */
export const CONFIGURABLE_NAV_ITEMS = [
  { href: "/reservations/manage", key: "reservations" },
  { href: "/handovers", key: "handovers" },
  { href: "/customers", key: "customers" },
  { href: "/cars", key: "vehicles" },
  { href: "/maintenance", key: "maintenance" },
].map(({ href, key }) => ({
  href,
  // Read when drawn, so it is in the language showing then.
  get label() {
    return t(`nav.${key}`);
  },
}));
