/**
 * What each role may do, for showing and hiding things.
 *
 * This mirrors backend/app/permissions.py and is NOT the security boundary: the
 * server refuses anything a role may not do, whatever this file says. It only
 * stops the interface from offering buttons that would end in an error. If the two
 * ever disagree, the server wins and the person sees its message.
 */

export type Role = "admin" | "manager" | "staff" | "readonly";

export const ROLES: Role[] = ["admin", "manager", "staff", "readonly"];

export type Permission =
  | "bookings.write"
  | "money.approve"
  | "customers.list_full"
  | "identity.read"
  | "reports.read"
  | "fleet.manage"
  | "admin.manage";

const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    "bookings.write",
    "money.approve",
    "customers.list_full",
    "identity.read",
    "reports.read",
    "fleet.manage",
    "admin.manage",
  ]),
  manager: new Set<Permission>([
    "bookings.write",
    "money.approve",
    "customers.list_full",
    "identity.read",
    "reports.read",
    "fleet.manage",
  ]),
  staff: new Set<Permission>(["bookings.write", "identity.read"]),
  readonly: new Set<Permission>(),
};

/** Whether a role holds a permission. An unknown or missing role holds none. */
export function can(role: string | null | undefined, permission: Permission): boolean {
  return PERMISSIONS[role as Role]?.has(permission) ?? false;
}

// The pages under /admin and what each needs. Managers use the reports, the audit
// log and the vehicle and extras settings; the rest is for administrators.
const MANAGER_CONFIGURATION_SECTIONS = [
  "/admin/configuration/vehicles",
  "/admin/configuration/classes",
  "/admin/configuration/extras",
];

/** Whether a role may open an /admin page (or an admin menu entry). */
export function canOpenAdminPage(role: string | null | undefined, pathname: string): boolean {
  if (can(role, "admin.manage")) return true;

  if (pathname.startsWith("/admin/audit-log") || pathname.startsWith("/admin/revenue")) {
    return can(role, "reports.read");
  }

  // The Configuration entry itself opens for managers (on the sections they may use).
  if (pathname === "/admin/configuration") return can(role, "fleet.manage");

  if (MANAGER_CONFIGURATION_SECTIONS.some((section) => pathname.startsWith(section))) {
    return can(role, "fleet.manage");
  }

  return false;
}

/** Where /admin/configuration should send a role that cannot see its first section. */
export function firstConfigurationPage(role: string | null | undefined): string {
  return can(role, "admin.manage") ? "/admin/configuration/business" : MANAGER_CONFIGURATION_SECTIONS[0];
}
