/**
 * The non-admin nav items an admin can hide from an individual
 * employee's sidebar (see components/users/EditUserModal.tsx and
 * components/Sidebar.tsx). "Overview" and the whole Admin section are
 * deliberately excluded — always visible, not configurable.
 */
export const CONFIGURABLE_NAV_ITEMS = [
  { href: "/reservations/manage", label: "Reservations" },
  { href: "/handovers", label: "Handovers" },
  { href: "/customers", label: "Customers" },
  { href: "/cars", label: "Vehicles" },
  { href: "/maintenance", label: "Maintenance" },
];
