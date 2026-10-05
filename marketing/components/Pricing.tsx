import { INCLUDED, plans, shownPrice, shownSetupFee, type Plan } from "@/content/plans";
import { getTranslator, type Translator } from "@/lib/i18n";
import { href } from "@/lib/links";

import { ButtonLink } from "./Button";

function euro(amount: number, language: string): string {
  return new Intl.NumberFormat(language, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(amount);
}

function PlanCard({ plan, language, t }: { plan: Plan; language: string; t: Translator }) {
  const price = shownPrice(plan);

  return (
    <li
      className={`relative flex flex-col rounded-2xl border p-7 ${
        plan.highlighted ? "border-accent bg-deep-raised ring-2 ring-accent" : "border-white/10 bg-deep-raised"
      }`}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-0.5 font-mono text-xs font-semibold uppercase tracking-wide text-accent-ink">
          {t("pricing.popular")}
        </span>
      )}

      <h3 className="display text-2xl font-bold">{t(`pricing.${plan.id}`)}</h3>
      <p className="mt-1 text-on-deep-muted">
        {plan.vehicles === null ? t("pricing.unlimited") : t("pricing.upTo", { count: plan.vehicles })}
      </p>

      <p className="mt-6 min-h-16">
        {price === null ? (
          <span className="display text-3xl font-bold">{t("pricing.quote")}</span>
        ) : (
          <>
            {plan.from && <span className="mr-1 text-on-deep-muted">{t("pricing.from")}</span>}
            <span className="display text-5xl font-bold">{euro(price, language)}</span>
            <span className="block text-sm text-on-deep-muted">{t("pricing.perMonth")}</span>
          </>
        )}
      </p>

      <ul className="mt-6 flex-1 space-y-2 border-t border-white/10 pt-6">
        {INCLUDED.map((key) => (
          <li key={key} className="flex gap-2">
            <span aria-hidden="true" className="text-accent">
              ✓
            </span>
            {t(`pricing.include.${key}`)}
          </li>
        ))}
      </ul>

      <ButtonLink href={href(language, "/demo")} variant={plan.highlighted ? "accent" : "outline"} className="mt-7">
        {t("pricing.cta")}
      </ButtonLink>
    </li>
  );
}

export function Pricing({ language }: { language: string }) {
  const t = getTranslator(language);
  const setup = shownSetupFee();

  return (
    <section id="pricing" className="bg-deep py-16 text-on-deep md:py-24">
      <div className="mx-auto max-w-300 px-4">
        <h2 className="display max-w-3xl text-4xl font-bold md:text-5xl">{t("pricing.title")}</h2>
        <p className="mt-4 max-w-2xl text-lg text-on-deep-muted">{t("pricing.sub")}</p>

        <ul className="mt-12 grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} language={language} t={t} />
          ))}
        </ul>

        <div className="mt-8 space-y-1 text-on-deep-muted">
          <p>{t("pricing.setup")}</p>
          {setup !== null && <p className="text-on-deep">{t("pricing.setupFee", { amount: euro(setup, language) })}</p>}
          <p>{t("pricing.annual")}</p>
          <p>{t("pricing.footnote")}</p>
        </div>
      </div>
    </section>
  );
}
