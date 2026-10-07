"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, SelectField, TextField } from "@/components/ui/Field";
import { createUser, type User } from "@/lib/api";
import { generatePassword } from "@/lib/password";
import { t } from "@/lib/i18n";

type Props = {
  onClose: () => void;
  onCreated: (user: User) => void;
};

export function NewUserModal({ onClose, onCreated }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [password, setPassword] = useState(generatePassword());
  const [copied, setCopied] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      // Clipboard permission denied — the field itself is still
      // selectable/copyable by hand.
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const user = await createUser({ email, password, role });
      onCreated(user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.users.NewUserModal.failedCreateUser"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.users.NewUserModal.newUser")}
      description={t("c.users.NewUserModal.thereNoEmailSystem")}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.users.NewUserModal.cancel")}</Button>
          <Button type="submit" form="new-user-form" loading={saving}>
            {saving ? t("c.users.NewUserModal.creating") : t("c.users.NewUserModal.createUser")}
          </Button>
        </>
      }
    >
      <form id="new-user-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label={t("c.users.NewUserModal.email")}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <SelectField
          label={t("c.users.NewUserModal.role")}
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="readonly">{t("c.users.NewUserModal.readonly")}</option>
          <option value="staff">{t("c.users.NewUserModal.staff")}</option>
          <option value="manager">{t("c.users.NewUserModal.manager")}</option>
          <option value="admin">{t("c.users.NewUserModal.admin")}</option>
        </SelectField>

        <Field label={t("c.users.NewUserModal.initialPassword")} hint={t("c.users.NewUserModal.atLeast8Characters")}>
          {(fieldProps) => (
            <div className="flex gap-2">
              <Input
                {...fieldProps}
                type="text"
                required
                minLength={8}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setCopied(false);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPassword(generatePassword());
                  setCopied(false);
                }}
              >{t("c.users.NewUserModal.generate")}</Button>
              <Button type="button" variant="secondary" onClick={handleCopy}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied ? t("c.users.NewUserModal.copied") : t("c.users.NewUserModal.copy")}
              </Button>
            </div>
          )}
        </Field>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
