"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { resetUserPassword, type User } from "@/lib/api";
import { generatePassword } from "@/lib/password";

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
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="Reset password"
      description={`Set a new password for ${user.email}. Copy it below and share it with them directly — there is no email system to deliver it.`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reset-password-form" loading={saving}>
            {saving ? "Saving" : "Reset password"}
          </Button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="New password" hint="At least 8 characters.">
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
              >
                Generate
              </Button>
              <Button type="button" variant="secondary" onClick={handleCopy}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
        </Field>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
