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
      setError("Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUsers();
  }, [refreshUsers]);

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
      `Deactivate ${user.email}? They will be signed out immediately and unable to log in again until reactivated.`,
    );

    if (!confirmed) return;

    try {
      await updateUser(user.id, { is_active: false });
      refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate user.");
    }
  }

  async function handleReactivate(user: User) {
    try {
      await updateUser(user.id, { is_active: true });
      refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reactivate user.");
    }
  }

  const columns: Column<User>[] = [
    {
      id: "email",
      header: "Email",
      mobile: "primary",
      cell: (user) => user.email,
      sortable: true,
      sortAccessor: (user) => user.email,
    },
    {
      id: "role",
      header: "Role",
      mobile: "trailing",
      cell: (user) => (
        <Badge
          colorClass={
            user.role === "admin"
              ? "bg-gray-900 text-white"
              : "bg-surface-sunken text-ink-secondary"
          }
        >
          {user.role}
        </Badge>
      ),
      sortable: true,
      sortAccessor: (user) => user.role,
    },
    {
      id: "status",
      header: "Status",
      mobile: "secondary",
      cell: (user) => (
        <Badge
          colorClass={
            user.is_active
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800"
          }
        >
          {user.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
      sortable: true,
      sortAccessor: (user) => (user.is_active ? "active" : "inactive"),
    },
    {
      id: "created",
      header: "Created",
      mobileLabel: "Created",
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
        title="Users"
        description="Manage staff and admin accounts. Deactivating an account signs it out immediately."
        actions={
          <Button onClick={() => setShowNewUser(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New user
          </Button>
        }
      />

      <Toolbar>
        <Field label="Search">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              placeholder="Search by email..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
        </Field>

        <Field label="Role">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="ALL">All roles</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </Select>
          )}
        </Field>

        <Field label="Status">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
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
            label: "Edit",
            onClick: (user) => setEditingUser(user),
          },
          {
            label: "Reset password",
            onClick: (user) => setResettingUser(user),
          },
          {
            label: "Deactivate",
            variant: "danger",
            onClick: handleDeactivate,
            hidden: (user) => !user.is_active || user.id === currentUser?.id,
          },
          {
            label: "Reactivate",
            onClick: handleReactivate,
            hidden: (user) => user.is_active,
          },
        ]}
        empty={{
          icon: UserCog,
          title: "No users found",
          description: "Nothing matches this filter right now.",
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
