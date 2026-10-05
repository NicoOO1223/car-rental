import type { Metadata } from "next";

import { getCountries } from "@shared/countries";

import { DemoForm, type FormCopy } from "@/components/DemoForm";
import { brand } from "@/content/brand";
import { FLEET_SIZES, type ErrorCode, type FieldName } from "@/lib/demoSchema";
import { getTranslator } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { contactEmail, href } from "@/lib/links";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = getTranslator(lang);

  return pageMetadata({ language: lang, path: "/demo", title: t("meta.demoTitle", { brand: brand.name }), description: t("meta.demoDescription") });
}

const FIELDS: FieldName[] = ["name", "company", "email", "country", "fleet", "message"];
const CODES: ErrorCode[] = ["required", "too_long", "invalid_email", "invalid_choice", "line_break"];

export default async function Demo({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);
  const email = contactEmail();
  // The copy the client form needs, resolved here so the browser never loads the catalogue.
  const [noticeBefore, noticeAfter = ""] = t("form.notice", { link: "\u0000" }).split("\u0000");

  const errors: FormCopy["errors"] = {};

  for (const field of FIELDS) {
    for (const code of CODES) {
      const key = `form.errors.${field}.${code}`;
      const text = t(key);

      // A missing message comes back as its own key: leave it out and let the form fall back.
      if (text !== key) (errors[field] ??= {})[code] = text;
    }
  }

  const copy: FormCopy = {
    labels: Object.fromEntries(FIELDS.map((field) => [field, t(`form.${field}`)])) as FormCopy["labels"],
    companyHint: t("form.companyHint"),
    emailHint: t("form.emailHint"),
    messageHint: t("form.messageHint"),
    countryPlaceholder: t("form.countryPlaceholder"),
    fleetPlaceholder: t("form.fleetPlaceholder"),
    fleetOptions: FLEET_SIZES.map((value) => ({ value, label: t(`form.fleetOption.${value}`) })),
    countries: getCountries(lang),
    submit: t("form.submit"),
    sending: t("form.sending"),
    noticeBefore,
    privacyLink: t("form.privacyLink"),
    noticeAfter,
    summary: t("form.summary"),
    errors,
    humanFailed: t("form.humanFailed"),
    humanChecking: t("form.humanChecking"),
    rateLimited: email ? t("form.rateLimited", { email }) : t("form.rateLimitedNoEmail"),
    serverError: email ? t("form.serverError", { email }) : t("form.serverErrorNoEmail"),
    sessionExpired: t("form.sessionExpired"),
    networkError: t("form.networkError"),
  };

  return (
    <main className="relative mx-auto max-w-300 px-4 py-14 md:py-20">
      <h1 className="display text-5xl font-bold md:text-6xl">{t("demo.title")}</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-secondary">{t("demo.sub")}</p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[7fr_5fr]">
        <div className="rounded-2xl border border-border-subtle bg-surface p-6 md:p-8">
          <DemoForm copy={copy} thanksHref={href(lang, "/demo/thanks")} privacyHref={href(lang, "/privacy")} />
          <noscript>
            <p className="mt-4 text-ink-secondary">
              {t("demo.noscript")} {email && <a className="underline" href={`mailto:${email}`}>{email}</a>}
            </p>
          </noscript>
        </div>

        <aside className="lg:pt-2">
          <h2 className="display text-2xl font-bold">{t("demo.sideTitle")}</h2>
          <ol className="mt-5 space-y-4">
            {(["side1", "side2", "side3"] as const).map((key, index) => (
              <li key={key} className="flex gap-4">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-sm text-on-deep">
                  {index + 1}
                </span>
                <span className="text-lg">{t(`demo.${key}`)}</span>
              </li>
            ))}
          </ol>
          {email && (
            <p className="mt-8 text-ink-secondary">
              {t("demo.sideEmail", { email: "\u0000" }).split("\u0000")[0]}
              <a href={`mailto:${email}`} className="font-semibold text-ink underline underline-offset-4">
                {email}
              </a>
              {t("demo.sideEmail", { email: "\u0000" }).split("\u0000")[1]}
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
