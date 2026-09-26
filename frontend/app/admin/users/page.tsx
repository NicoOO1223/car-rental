"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, UserCog } from "lucide-react";

import { getUsers, updateUser, type User } from "@/lib/api";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { Toolbar } from "@/components/ui/Toolbar";
import { EditUserModal } from "@/components/users/EditUserModal";
import { NewUserModal } from "@/components/users/NewUserModal";
import { ResetPasswordModal } from "@/components/users/ResetPasswordModal";
import { formatDateTime } from "@/lib/format";
import { t, enumLabel } from "@/lib/i18n";

export default function UsersPage() {
  const { user: currentUser } = useCurrentUser();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [showNewUser, setShowNewUser] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resettingUser, setResettingUser] = useState<User | null>(null);

  const refreshUsers = useCallback(async () => {
    setError("");

    try {
      setUsers(await getUsers());
    } catch {
      setError(t("s.admin.users.failedLoadUsers"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Same effect as calling refreshUsers() directly, but defined inline
    // (matching every other page's mount-time load effect in this app)
    // rather than invoking the shared useCallback, which the stricter
    // set-state-in-effect lint rule flags as a cascading-render risk.
    async function load() {
      setError("");

      try {
        setUsers(await getUsers());
      } catch {
        setError(t("s.admin.users.failedLoadUsers"));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return users.filter((user) => {
      if (query && !user.email.toLowerCase().includes(query)) return false;
      if (roleFilter !== "ALL" && user.role !== roleFilter) return false;
      if (statusFilter === "ACTIVE" && !user.is_active) return false;
      if (statusFilter === "INACTIVE" && user.is_active) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  async function handleDeactivate(user: User) {
    const confirmed = window.confirm(
      t("s.admin.users.deactivateTheyWillBe", { email: user.email }),
    );

    if (!confirmed) return;

    try {
      await updateUser(user.id, { is_active: false });
      refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.users.failedDeactivateUser"));
    }
  }

  async function handleReactivate(user: User) {
    try {
      await updateUser(user.id, { is_active: true });
      refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.users.failedReactivateUser"));
    }
  }

  const columns: Column<User>[] = [
    {
      id: "email",
      header: t("s.admin.users.email"),
      mobile: "primary",
      cell: (user) => user.email,
      sortable: true,
      sortAccessor: (user) => user.email,
    },
    {
      id: "role",
      header: t("s.admin.users.role"),
      mobile: "trailing",
      cell: (user) => (
        <Badge
          colorClass={
            user.role === "admin"
              ? "bg-gray-900 text-white"
              : "bg-surface-sunken text-ink-secondary"
          }
        >
          {enumLabel("role", user.role)}
        </Badge>
      ),
      sortable: true,
      sortAccessor: (user) => user.role,
    },
    {
      id: "status",
      header: t("s.admin.users.status"),
      mobile: "secondary",
      cell: (user) => (
        <Badge
          colorClass={
            user.is_active
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800"
          }
        >
          {user.is_active ? t("s.admin.users.active") : t("s.admin.users.inactive")}
        </Badge>
      ),
      sortable: true,
      sortAccessor: (user) => (user.is_active ? "active" : "inactive"),
    },
    {
      id: "created",
      header: t("s.admin.users.created"),
      mobileLabel: t("s.admin.users.created"),
      cell: (user) => (
        <span className="text-sm text-ink-muted">
          {formatDateTime(user.created_at)}
        </span>
      ),
      sortable: true,
      sortAccessor: (user) => new Date(user.created_at),
      defaultSortDirection: "desc",
    },
  ];

  return (
    <PageShell width="medium">
      <PageHeader
        title={t("s.admin.users.users")}
        description={t("s.admin.users.manageStaffAdminAccounts")}
        actions={
          <Button onClick={() => setShowNewUser(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />{t("s.admin.users.newUser")}</Button>
        }
      />

      <Toolbar>
        <Field label={t("s.admin.users.search")}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              placeholder={t("s.admin.users.searchByEmail")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
        </Field>

        <Field label={t("s.admin.users.role")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="ALL">{t("s.admin.users.allRoles")}</option>
              <option value="admin">{t("s.admin.users.admin")}</option>
              <option value="staff">{t("s.admin.users.staff")}</option>
            </Select>
          )}
        </Field>

        <Field label={t("s.admin.users.status")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="ALL">{t("s.admin.users.allStatuses")}</option>
              <option value="ACTIVE">{t("s.admin.users.active")}</option>
              <option value="INACTIVE">{t("s.admin.users.inactive")}</option>
            </Select>
          )}
        </Field>
      </Toolbar>

      {error && (
        <div className="mb-6 rounded-xl bg-surface p-6 shadow-sm">
          <p className="text-red-600" role="alert">
            {error}
          </p>
        </div>
      )}

      <DataTable
        rows={filteredUsers}
        columns={columns}
        rowKey={(user) => user.id}
        loading={loading}
        rowActions={[
          {
            label: t("s.admin.users.edit"),
            onClick: (user) => setEditingUser(user),
          },
          {
            label: t("s.admin.users.resetPassword"),
            onClick: (user) => setResettingUser(user),
          },
          {
            label: t("s.admin.users.deactivate"),
            variant: "danger",
            onClick: handleDeactivate,
            hidden: (user) => !user.is_active || user.id === currentUser?.id,
          },
          {
            label: t("s.admin.users.reactivate"),
            onClick: handleReactivate,
            hidden: (user) => user.is_active,
          },
        ]}
        empty={{
          icon: UserCog,
          title: t("s.admin.users.noUsersFound"),
          description: t("s.admin.users.nothingMatchesFilterRight"),
        }}
      />

      {showNewUser && (
        <NewUserModal
          onClose={() => setShowNewUser(false)}
          onCreated={refreshUsers}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          isSelf={editingUser.id === currentUser?.id}
          onClose={() => setEditingUser(null)}
          onSaved={refreshUsers}
        />
      )}

      {resettingUser && (
        <ResetPasswordModal
          user={resettingUser}
          onClose={() => setResettingUser(null)}
          onReset={refreshUsers}
        />
      )}
    </PageShell>
  );
}
