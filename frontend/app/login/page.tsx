"use client";

import { useState } from "react";


import { login } from "@/lib/api";
import { BrandMark } from "@/components/BrandMark";
import { useBrand } from "@/components/BrandProvider";
import { LanguagePicker } from "@/components/LanguagePicker";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { hardNavigate } from "@/lib/hardNavigate";
import { t } from "@/lib/i18n";

export default function LoginPage() {
  const { name: brandName } = useBrand();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSubmitting(true);
    setError("");

    try {
      await login(email, password);
      // A full load rather than a client transition, so everything starts
      // from scratch with the new session in place.
      hardNavigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.failed"));
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4 sm:p-8">
      <div className="w-full max-w-sm rounded-xl bg-surface p-8 shadow-sm">
        <BrandMark className="mb-6 h-12 w-12" />

        <h1 className="min-h-8 text-2xl font-bold tracking-tight text-ink">
          {brandName}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("auth.subtitle")}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label={t("auth.email")}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <TextField
            label={t("auth.password")}
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" fullWidth loading={submitting}>
            {submitting ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
        </form>

        <LanguagePicker className="mt-6" />
      </div>
    </main>
  );
}
