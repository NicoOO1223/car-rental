"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, SelectField, TextField } from "@/components/ui/Field";
import { createUser, type User } from "@/lib/api";
import { generatePassword } from "@/lib/password";

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
      setError(err instanceof Error ? err.message : "Failed to create user.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="New user"
      description="There is no email system to deliver credentials — copy the password below and share it with them directly."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-user-form" loading={saving}>
            {saving ? "Creating" : "Create user"}
          </Button>
        </>
      }
    >
      <form id="new-user-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <SelectField
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </SelectField>

        <Field label="Initial password" hint="At least 8 characters.">
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
