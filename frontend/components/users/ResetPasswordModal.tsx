"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { resetUserPassword, type User } from "@/lib/api";
import { generatePassword } from "@/lib/password";
import { t } from "@/lib/i18n";

type Props = {
  user: User;
  onClose: () => void;
  onReset: (user: User) => void;
};

export function ResetPasswordModal({ user, onClose, onReset }: Props) {
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
      const updated = await resetUserPassword(user.id, password);
      onReset(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.users.ResetPasswordModal.failedResetPassword"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.users.ResetPasswordModal.resetPassword")}
      description={t("c.users.ResetPasswordModal.setNewPasswordCopy", { email: user.email })}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.users.ResetPasswordModal.cancel")}</Button>
          <Button type="submit" form="reset-password-form" loading={saving}>
            {saving ? t("c.users.ResetPasswordModal.saving") : t("c.users.ResetPasswordModal.resetPassword")}
          </Button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label={t("c.users.ResetPasswordModal.newPassword")} hint={t("c.users.ResetPasswordModal.atLeast8Characters")}>
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
              >{t("c.users.ResetPasswordModal.generate")}</Button>
              <Button type="button" variant="secondary" onClick={handleCopy}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied ? t("c.users.ResetPasswordModal.copied") : t("c.users.ResetPasswordModal.copy")}
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
