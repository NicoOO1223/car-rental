import type { Feature } from "@/content/features";
import { getTranslator } from "@/lib/i18n";

import { Screenshot } from "./Screenshot";

// One feature: headline, sub, bullets and a captioned screenshot. `reverse`
// puts the picture on the left on wide screens; on a phone the text always
// comes first.
export function FeatureBlock({ feature, language, reverse }: { feature: Feature; language: string; reverse: boolean }) {
  const t = getTranslator(language);
  const base = `features.${feature.id}`;
  const bullets = Array.from({ length: feature.bullets }, (_, index) => `${base}.b${index + 1}`);

  return (
    <article className="mx-auto grid max-w-300 items-center gap-10 px-4 py-14 md:grid-cols-2 md:gap-16 md:py-20">
      <div className={reverse ? "md:order-2" : ""}>
        <h3 className="display text-3xl font-bold md:text-4xl">{t(`${base}.title`)}</h3>
        <p className="mt-4 text-lg text-ink-secondary">{t(`${base}.sub`)}</p>
        <ul className="mt-6 space-y-3">
          {bullets.map((key) => (
            <li key={key} className="flex gap-3">
              <svg aria-hidden="true" className="mt-1.5 size-4 shrink-0" viewBox="0 0 16 16" fill="none">
                <rect width="16" height="16" rx="4" fill="var(--accent)" />
                <path d="M4.5 8.5l2.2 2.2 4.8-5" stroke="#0a0a0a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={reverse ? "md:order-1" : ""}>
        <figure>
          <Screenshot id={feature.screen} language={language} />
          <figcaption className="mt-3 text-center text-sm text-ink-muted">{t(`screens.${feature.screen}.caption`)}</figcaption>
        </figure>

        {feature.more && (
          <div className="mt-6 grid grid-cols-2 gap-4">
            {feature.more.map((id) => (
              <figure key={id}>
                <Screenshot id={id} language={language} small />
                <figcaption className="mt-2 text-center text-xs text-ink-muted">{t(`screens.${id}.caption`)}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
