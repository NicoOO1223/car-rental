"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { updateUser, type User } from "@/lib/api";
import { CONFIGURABLE_NAV_ITEMS } from "@/lib/navItems";
import { t } from "@/lib/i18n";

type Props = {
  user: User;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (updated: User) => void;
};

export function EditUserModal({ user, isSelf, onClose, onSaved }: Props) {
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<string>(user.role);
  const [hiddenNavItems, setHiddenNavItems] = useState<Set<string>>(
    () => new Set(user.hidden_nav_items),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleNavItem(href: string, visible: boolean) {
    setHiddenNavItems((current) => {
      const next = new Set(current);
      if (visible) {
        next.delete(href);
      } else {
        next.add(href);
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const updated = await updateUser(user.id, {
        email,
        role,
        hidden_nav_items: Array.from(hiddenNavItems),
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.users.EditUserModal.failedUpdateUser"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.users.EditUserModal.editUser")}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.users.EditUserModal.cancel")}</Button>
          <Button type="submit" form="edit-user-form" loading={saving}>
            {saving ? t("c.users.EditUserModal.saving") : t("c.users.EditUserModal.saveChanges")}
          </Button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label={t("c.users.EditUserModal.email")}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <SelectField
          label={t("c.users.EditUserModal.role")}
          value={role}
          disabled={isSelf}
          hint={isSelf ? t("c.users.EditUserModal.youCannotChangeOwn") : undefined}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="staff">{t("c.users.EditUserModal.staff")}</option>
          <option value="admin">{t("c.users.EditUserModal.admin")}</option>
        </SelectField>

        <fieldset>
          <legend className="block text-sm font-medium text-ink">{t("c.users.EditUserModal.visiblePages")}</legend>
          <p className="mt-1 text-xs text-ink-muted">{t("c.users.EditUserModal.uncheckedPagesHiddenFrom")}</p>

          <div className="mt-2 space-y-2">
            {CONFIGURABLE_NAV_ITEMS.map((item) => (
              <label
                key={item.href}
                className="flex items-center gap-2 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-strong text-gray-900 focus:ring-2 focus:ring-gray-900"
                  checked={!hiddenNavItems.has(item.href)}
                  onChange={(event) =>
                    toggleNavItem(item.href, event.target.checked)
                  }
                />
                {item.label}
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
