"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { buttonClass } from "@/components/Button";
import { Turnstile } from "@/components/Turnstile";
import { parseDemoRequest, type ErrorCode, type FieldName } from "@/lib/demoSchema";

export type FormCopy = {
  labels: Record<FieldName, string>;
  companyHint: string;
  emailHint: string;
  messageHint: string;
  countryPlaceholder: string;
  fleetPlaceholder: string;
  fleetOptions: { value: string; label: string }[];
  countries: { code: string; name: string }[];
  submit: string;
  sending: string;
  noticeBefore: string;
  privacyLink: string;
  noticeAfter: string;
  summary: string;
  errors: Partial<Record<FieldName, Partial<Record<ErrorCode, string>>>>;
  humanFailed: string;
  humanChecking: string;
  rateLimited: string;
  serverError: string;
  sessionExpired: string;
  networkError: string;
};

type Errors = Partial<Record<FieldName, ErrorCode>>;
type Status = "idle" | "sending";

const FIELD_ORDER: FieldName[] = ["name", "company", "email", "country", "fleet", "message"];
const INPUT =
  "mt-1.5 block min-h-12 w-full rounded-lg border border-border-strong bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-muted aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger";

export function DemoForm({ copy, thanksHref, privacyHref }: { copy: FormCopy; thanksHref: string; privacyHref: string }) {
  const router = useRouter();
  const uid = useId();
  const summary = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<FieldName, string>>({ name: "", company: "", email: "", country: "", fleet: "", message: "" });
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [session, setSession] = useState<{ token: string; siteKey: string | null } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [resetKey, setResetKey] = useState(0);

  // The signed timestamp and the Turnstile key come from the server when the form opens.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/demo/session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("session"))))
      .then((data) => !cancelled && setSession(data))
      .catch(() => !cancelled && setSession({ token: "", siteKey: null }));

    return () => {
      cancelled = true;
    };
  }, []);

  const id = (field: string) => `${uid}-${field}`;
  const waitingForHuman = Boolean(session?.siteKey) && !turnstileToken;
  const showSummary = Object.keys(errors).length > 0 || formError !== null;

  function set(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));

    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function message(field: FieldName, code: ErrorCode): string {
    return copy.errors[field]?.[code] ?? copy.errors[field]?.required ?? copy.labels[field];
  }

  function focusSummary() {
    // After the summary has rendered.
    requestAnimationFrame(() => summary.current?.focus());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (status === "sending") return;

    setFormError(null);

    const parsed = parseDemoRequest(values);

    if (!parsed.ok) {
      setErrors(parsed.errors);
      focusSummary();

      return;
    }

    setErrors({});
    setStatus("sending");

    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed.data, website: honeypot, token: session?.token ?? "", turnstileToken }),
      });

      if (response.ok) {
        try {
          sessionStorage.setItem("demo-thanks", JSON.stringify({ name: parsed.data.name.split(" ")[0], email: parsed.data.email }));
        } catch {
          // Private mode: the thank-you page then shows its generic wording.
        }

        router.push(thanksHref);

        return;
      }

      const body = (await response.json().catch(() => ({}))) as { error?: string; errors?: Errors };

      if (response.status === 400 && body.errors) setErrors(body.errors);
      else if (response.status === 403 && body.error === "human_check_failed") setFormError(copy.humanFailed);
      else if (response.status === 403 && body.error === "session_expired") setFormError(copy.sessionExpired);
      else if (response.status === 429) setFormError(copy.rateLimited);
      else setFormError(copy.serverError);
    } catch {
      setFormError(copy.networkError);
    }

    // A Turnstile token works once, so a failed attempt needs a fresh one.
    setTurnstileToken("");
    setResetKey((key) => key + 1);
    setStatus("idle");
    focusSummary();
  }

  const fields = FIELD_ORDER.filter((field) => errors[field]);

  return (
    <form onSubmit={submit} noValidate aria-busy={status === "sending"} className="space-y-6">
      {showSummary && (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-danger bg-surface p-4 text-base text-danger outline-offset-4"
        >
          {formError && <p>{formError}</p>}
          {fields.length > 0 && (
            <>
              <p className="font-semibold">{copy.summary}</p>
              <ul className="mt-1 list-disc pl-5">
                {fields.map((field) => (
                  <li key={field}>
                    <a href={`#${id(field)}`} className="underline" onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(id(field))?.focus();
                    }}>
                      {message(field, errors[field] as ErrorCode)}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id={id("name")} label={copy.labels.name} error={errors.name && message("name", errors.name)}>
          <input id={id("name")} name="name" autoComplete="name" value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={100}
            aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${id("name")}-error` : undefined} className={INPUT} />
        </Field>
        <Field id={id("company")} label={copy.labels.company} hint={copy.companyHint} error={errors.company && message("company", errors.company)}>
          <input id={id("company")} name="company" autoComplete="organization" value={values.company} onChange={(e) => set("company", e.target.value)} maxLength={150}
            aria-invalid={Boolean(errors.company)} aria-describedby={describedBy(id("company"), true, Boolean(errors.company))} className={INPUT} />
        </Field>
      </div>

      <Field id={id("email")} label={copy.labels.email} hint={copy.emailHint} error={errors.email && message("email", errors.email)}>
        <input id={id("email")} name="email" type="email" autoComplete="email" inputMode="email" value={values.email} onChange={(e) => set("email", e.target.value)} maxLength={254}
          aria-invalid={Boolean(errors.email)} aria-describedby={describedBy(id("email"), true, Boolean(errors.email))} className={INPUT} />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id={id("country")} label={copy.labels.country} error={errors.country && message("country", errors.country)}>
          <select id={id("country")} name="country" autoComplete="country" value={values.country} onChange={(e) => set("country", e.target.value)}
            aria-invalid={Boolean(errors.country)} aria-describedby={errors.country ? `${id("country")}-error` : undefined} className={INPUT}>
            <option value="">{copy.countryPlaceholder}</option>
            {copy.countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id("fleet")} label={copy.labels.fleet} error={errors.fleet && message("fleet", errors.fleet)}>
          <select id={id("fleet")} name="fleet" value={values.fleet} onChange={(e) => set("fleet", e.target.value)}
            aria-invalid={Boolean(errors.fleet)} aria-describedby={errors.fleet ? `${id("fleet")}-error` : undefined} className={INPUT}>
            <option value="">{copy.fleetPlaceholder}</option>
            {copy.fleetOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field id={id("message")} label={copy.labels.message} hint={copy.messageHint} error={errors.message && message("message", errors.message)}>
        <textarea id={id("message")} name="message" rows={5} value={values.message} onChange={(e) => set("message", e.target.value)}
          aria-invalid={Boolean(errors.message)} aria-describedby={describedBy(id("message"), true, Boolean(errors.message))} className={INPUT} />
      </Field>

      {/* The honeypot: invisible and unreachable for a person, tempting for a script. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
        </label>
      </div>

      {session?.siteKey && <Turnstile siteKey={session.siteKey} onToken={setTurnstileToken} resetKey={resetKey} />}

      <div>
        <button
          type="submit"
          disabled={status === "sending" || waitingForHuman}
          className={`${buttonClass("dark")} w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto`}
        >
          {status === "sending" ? copy.sending : copy.submit}
        </button>

        <p role="status" className="mt-2 min-h-6 text-sm text-ink-muted">
          {waitingForHuman ? copy.humanChecking : ""}
        </p>
      </div>

      <p className="text-sm text-ink-secondary">
        {copy.noticeBefore}
        <Link prefetch={false} href={privacyHref} className="underline underline-offset-2">
          {copy.privacyLink}
        </Link>
        {copy.noticeAfter}
      </p>
    </form>
  );
}

function describedBy(base: string, hasHint: boolean, hasError: boolean): string | undefined {
  if (hasError) return `${base}-error`;

  return hasHint ? `${base}-hint` : undefined;
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-base font-semibold text-ink">
        {label}
      </label>
      {children}
      {/* The hint sits under the input so side-by-side fields line up; an error replaces it. */}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
