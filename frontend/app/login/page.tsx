"use client";

import { useState } from "react";

import { login, setToken } from "@/lib/api";
import { BrandMark } from "@/components/BrandMark";
import { useBrand } from "@/components/BrandProvider";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";

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
      const { access_token } = await login(email, password);
      setToken(access_token);
      // A full load rather than a client transition, so the auth guard
      // re-evaluates from scratch with the new token in place.
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log in.");
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
          Sign in to the management panel.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <TextField
            label="Password"
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
            {submitting ? "Signing in" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
