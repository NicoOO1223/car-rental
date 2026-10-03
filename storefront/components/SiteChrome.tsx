import Link from "next/link";
import { Suspense } from "react";

import type { PublicConfig } from "@shared/publicApi";

import { LanguagePicker } from "@/components/LanguagePicker";
import { runtimeConfig } from "@/lib/runtime";
import { getTranslator } from "@/lib/i18n";

/** The bar at the top of every page: who this is, where to go, which language. */
export function SiteHeader({ language, config }: { language: string; config: PublicConfig | null }) {
  const t = getTranslator(language);
  const logo = config?.has_logo ? `${runtimeConfig().apiUrl}/api/branding/logo?v=${config.logo_version ?? 0}` : null;

  return (
    <header className="border-b border-border-subtle bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href={`/${language}`} className="flex items-center gap-2 font-semibold text-ink">
          {logo && (
            // The logo is an image the business uploaded, served by its own API.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-8 w-8 rounded object-contain" />
          )}
          {config?.business_name ?? ""}
        </Link>

        <div className="flex flex-wrap items-center gap-y-2 text-sm">
          {config?.storefront_enabled && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link href={`/${language}/fleet`} className="text-ink-secondary hover:text-ink">
                {t("nav.fleet")}
              </Link>
              <Link href={`/${language}/manage`} className="text-ink-secondary hover:text-ink">
                {t("nav.manage")}
              </Link>
            </div>
          )}

          {/* A utility control, not a page to go to — kept visually
              separate from the nav links above with a divider and a
              lighter weight, so it doesn't read as a third destination.
              The divider only makes sense once there's something to its
              left to divide from. */}
          <div className={config?.storefront_enabled ? "ml-5 border-l border-border-subtle pl-5" : ""}>
            <Suspense fallback={null}>
              <LanguagePicker current={language} />
            </Suspense>
          </div>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ language, config }: { language: string; config: PublicConfig | null }) {
  const t = getTranslator(language);

  if (!config?.storefront_enabled) return null;

  return (
    <footer className="mt-16 border-t border-border-subtle bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-ink-muted">
        <span>{config.business_name}</span>

        <span className="flex gap-5">
          <Link href={`/${language}/terms`} className="hover:text-ink">
            {t("footer.terms")}
          </Link>
          <Link href={`/${language}/privacy`} className="hover:text-ink">
            {t("footer.privacy")}
          </Link>
        </span>
      </div>
    </footer>
  );
}
