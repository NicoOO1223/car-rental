import { ButtonLink } from "@/components/Button";
import { FeatureBlock } from "@/components/FeatureBlock";
import { Faq } from "@/components/Faq";
import { Pricing } from "@/components/Pricing";
import { Screenshot } from "@/components/Screenshot";
import { brand } from "@/content/brand";
import { features } from "@/content/features";
import { getTranslator } from "@/lib/i18n";
import { contactEmail, href } from "@/lib/links";

const FACTS = ["f1", "f2", "f3", "f4"] as const;
const CHIPS = ["c1", "c2", "c3"] as const;
const STEPS = ["s1", "s2", "s3"] as const;

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);
  const email = contactEmail();
  const demo = href(lang, "/demo");

  return (
    <main>
      <section id="hero" className="bg-deep pb-0 pt-14 text-on-deep md:pt-24">
        <div className="mx-auto max-w-300 px-4">
          <h1 className="display max-w-4xl text-5xl font-bold md:text-7xl">{t("hero.title")}</h1>
          <p className="mt-6 max-w-2xl text-lg text-on-deep-muted md:text-xl">{t("hero.sub")}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <ButtonLink href={demo}>{t("hero.cta")}</ButtonLink>
            <a href="#features" className="min-h-11 py-2 text-base text-on-deep underline underline-offset-4">
              {t("hero.secondary")}
            </a>
          </div>
        </div>
        <div className="mx-auto mt-12 max-w-360 px-4">
          <Screenshot id="dashboard" language={lang} priority dark wide />
        </div>
      </section>

      <section aria-label={brand.name} className="border-b border-border-subtle bg-surface">
        <ul className="mx-auto grid max-w-300 gap-x-6 gap-y-3 px-4 py-6 font-mono text-sm uppercase tracking-wide text-ink-secondary sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2 rounded-[2px] bg-accent ring-1 ring-ink/20" />
              {t(`facts.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-300 px-4 py-16 md:py-24">
        <h2 className="display max-w-3xl text-4xl font-bold md:text-5xl">{t("promise.title")}</h2>
        <p className="mt-6 max-w-3xl text-xl text-ink-secondary">{t("promise.text", { brand: brand.name })}</p>
        <ul className="mt-6 flex flex-wrap gap-2">
          {CHIPS.map((key) => (
            <li key={key} className="rounded-full border border-border-strong bg-surface px-4 py-1.5 text-base text-ink-secondary line-through decoration-ink-muted">
              {t(`promise.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      <section id="features" className="border-t border-border-subtle bg-surface">
        <h2 className="mx-auto max-w-300 px-4 pt-16 display text-4xl font-bold md:pt-24 md:text-5xl">{t("features.title")}</h2>
        {features.map((feature, index) => (
          <FeatureBlock key={feature.id} feature={feature} language={lang} reverse={index % 2 === 1} />
        ))}
      </section>

      <section id="how-it-works" className="mx-auto max-w-300 px-4 py-16 md:py-24">
        <h2 className="display max-w-3xl text-4xl font-bold md:text-5xl">{t("how.title")}</h2>
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((key, index) => (
            <li key={key} className="border-t-2 border-ink pt-5">
              <span className="font-mono text-sm text-ink-muted">0{index + 1}</span>
              <h3 className="display mt-2 text-2xl font-bold">{t(`how.${key}Title`)}</h3>
              <p className="mt-2 text-ink-secondary">{t(`how.${key}Body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <Pricing language={lang} />

      <Faq language={lang} />

      <section className="bg-deep py-16 text-on-deep md:py-24">
        <div className="mx-auto max-w-300 px-4">
          <h2 className="display max-w-3xl text-4xl font-bold md:text-6xl">{t("final.title")}</h2>
          <p className="mt-4 max-w-xl text-lg text-on-deep-muted">{t("final.sub")}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <ButtonLink href={demo}>{t("final.cta")}</ButtonLink>
            {email && <span className="text-on-deep-muted">{t("final.orWrite", { email })}</span>}
          </div>
        </div>
      </section>
    </main>
  );
}
