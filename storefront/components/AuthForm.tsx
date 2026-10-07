"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { Turnstile } from "@/components/Turnstile";
import { accountApi } from "@/lib/account";
import { errorMessage } from "@/lib/errors";

const input =
  "mt-1.5 w-full rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900";

/** Log in, or create an account. After either, the visitor goes on to `next` (default: their bookings). */
export function AuthForm({ mode, language, next }: { mode: "login" | "register"; language: string; next?: string }) {
  const t = useTranslations("auth");
  const all = useTranslations();
  const router = useRouter();
  const registering = mode === "register";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);

  const humanChecked = token !== null && (token !== "" || !window.__RUNTIME_CONFIG__?.turnstileSiteKey);

  // Only ever a path on this site, never an address someone else supplied.
  const destination = next && next.startsWith(`/${language}/`) && !next.startsWith("//") ? next : `/${language}/account`;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    const credentials = { email: email.trim(), password, captcha_token: token ?? "" };

    try {
      if (registering) {
        await accountApi.register({ ...credentials, first_name: firstName.trim(), last_name: lastName.trim(), language });
        setRegistered(true);
        setBusy(false);

        return;
      }

      await accountApi.login(credentials);

      router.push(destination);
      // The header reads the session on the server: ask it to look again.
      router.refresh();
    } catch (failure) {
      setError(errorMessage(all, failure));
      setResetKey((count) => count + 1);
      setBusy(false);
    }
  }

  const otherHref = `/${language}/${registering ? "login" : "register"}${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  if (registered) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm sm:p-8" role="status">
        <h1 className="text-2xl font-bold tracking-tight">{t("checkEmailTitle")}</h1>
        <p className="mt-3 text-ink-secondary">{t("checkEmailBody", { email: email.trim() })}</p>
        <Link
          href={`/${language}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="mt-6 inline-block rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          {t("loginTitle")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight">{registering ? t("registerTitle") : t("loginTitle")}</h1>
      <p className="mt-2 text-ink-secondary">{registering ? t("registerIntro") : t("loginIntro")}</p>

      <div className="mt-6 space-y-4">
        {registering && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              {t("firstName")}
              <input
                className={input}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoComplete="given-name"
                maxLength={100}
                required
              />
            </label>

            <label className="block text-sm font-medium">
              {t("lastName")}
              <input
                className={input}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                autoComplete="family-name"
                maxLength={100}
                required
              />
            </label>
          </div>
        )}

        <label className="block text-sm font-medium">
          {t("email")}
          <input
            className={input}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>

        <label className="block text-sm font-medium">
          {t("password")}
          <input
            className={input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={registering ? "new-password" : "current-password"}
            minLength={registering ? 8 : undefined}
            maxLength={128}
            required
            aria-describedby={registering ? "password-hint" : undefined}
          />
          {registering && (
            <span id="password-hint" className="mt-1 block text-xs font-normal text-ink-muted">
              {t("passwordHint")}
            </span>
          )}
        </label>

        {!registering && (
          <p className="text-right text-sm">
            <Link href={`/${language}/account/forgot-password`} className="font-medium text-ink-secondary underline underline-offset-4">
              {t("forgotLink")}
            </Link>
          </p>
        )}

        <Turnstile onToken={setToken} resetKey={resetKey} language={language} />
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !humanChecked}
        className="mt-6 w-full rounded-xl bg-accent px-4 py-3.5 text-sm font-semibold text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {busy ? (registering ? t("registering") : t("loggingIn")) : registering ? t("registerSubmit") : t("loginSubmit")}
      </button>

      <p className="mt-5 text-center text-sm text-ink-secondary">
        {registering ? t("haveAccount") : t("noAccount")}{" "}
        <Link href={otherHref} className="font-semibold text-ink underline underline-offset-4">
          {registering ? t("loginTitle") : t("registerTitle")}
        </Link>
      </p>

      <p className="mt-2 text-center text-sm text-ink-muted">
        {t("guestHint")}{" "}
        <Link href={`/${language}/manage`} className="font-medium underline underline-offset-4">
          {t("guestLink")}
        </Link>
      </p>
    </form>
  );
}
