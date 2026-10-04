import { describe, expect, it } from "vitest";

import { can, canOpenAdminPage, firstConfigurationPage, ROLES } from "@/lib/permissions";

describe("what each role can do", () => {
  it("gives administrators everything", () => {
    for (const permission of ["bookings.write", "money.approve", "customers.list_full", "identity.read", "reports.read", "fleet.manage", "admin.manage"] as const) {
      expect(can("admin", permission)).toBe(true);
    }
  });

  it("lets a manager approve money and see reports but not administer", () => {
    expect(can("manager", "money.approve")).toBe(true);
    expect(can("manager", "reports.read")).toBe(true);
    expect(can("manager", "fleet.manage")).toBe(true);
    expect(can("manager", "admin.manage")).toBe(false);
  });

  it("lets counter staff work but not approve", () => {
    expect(can("staff", "bookings.write")).toBe(true);
    expect(can("staff", "identity.read")).toBe(true);
    expect(can("staff", "money.approve")).toBe(false);
    expect(can("staff", "customers.list_full")).toBe(false);
    expect(can("staff", "reports.read")).toBe(false);
  });

  it("lets a read-only account do nothing, and treats an unknown role the same way", () => {
    for (const role of ["readonly", "janitor", "", null, undefined]) {
      expect(can(role, "bookings.write")).toBe(false);
      expect(can(role, "identity.read")).toBe(false);
    }
  });

  it("has the four roles the server has", () => {
    expect(ROLES).toEqual(["admin", "manager", "staff", "readonly"]);
  });
});

describe("the admin pages", () => {
  it("opens everything for administrators", () => {
    for (const path of ["/admin/users", "/admin/configuration/business", "/admin/audit-log", "/admin/revenue"]) {
      expect(canOpenAdminPage("admin", path)).toBe(true);
    }
  });

  it("opens reports, the audit log, vehicles and extras for a manager, and nothing else", () => {
    for (const path of ["/admin/audit-log", "/admin/revenue", "/admin/configuration", "/admin/configuration/vehicles", "/admin/configuration/extras"]) {
      expect(canOpenAdminPage("manager", path)).toBe(true);
    }

    for (const path of ["/admin/users", "/admin/configuration/business", "/admin/configuration/pricing", "/admin/configuration/system", "/admin/unknown"]) {
      expect(canOpenAdminPage("manager", path)).toBe(false);
    }
  });

  it("opens none of it for staff or read-only accounts", () => {
    for (const role of ["staff", "readonly"]) {
      expect(canOpenAdminPage(role, "/admin/audit-log")).toBe(false);
      expect(canOpenAdminPage(role, "/admin/configuration/vehicles")).toBe(false);
    }
  });

  it("starts a manager in a section they can use", () => {
    expect(firstConfigurationPage("manager")).toBe("/admin/configuration/vehicles");
    expect(firstConfigurationPage("admin")).toBe("/admin/configuration/business");
  });
});
