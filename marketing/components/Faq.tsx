import { getTranslator } from "@/lib/i18n";

export const FAQ_COUNT = 10;

// A native <details> accordion: keyboard accessible, announces expanded and
// collapsed, and works without JavaScript. The first two start open.
export function Faq({ language }: { language: string }) {
  const t = getTranslator(language);

  return (
    <section id="faq" className="mx-auto max-w-300 px-4 py-16 md:py-24">
      <h2 className="display max-w-3xl text-4xl font-bold md:text-5xl">{t("faq.title")}</h2>

      <div className="mt-10 max-w-3xl divide-y divide-border-subtle border-y border-border-subtle">
        {Array.from({ length: FAQ_COUNT }, (_, index) => index + 1).map((n) => (
          <details key={n} open={n <= 2} className="group py-1">
            <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-3 text-lg font-semibold">
              {t(`faq.q${n}`)}
              <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 10h12" />
                <path className="faq-icon-v" d="M10 4v12" />
              </svg>
            </summary>
            <p className="pb-4 text-ink-secondary">{t(`faq.a${n}`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
