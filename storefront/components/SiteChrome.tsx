import Link from "next/link";

import type { PublicConfig, PublicLocation } from "@shared/publicApi";

import { HeaderBar } from "@/components/HeaderBar";
import { FacebookIcon, InstagramIcon, WhatsAppIcon, XIcon } from "@/components/SocialIcons";
import type { Account } from "@/lib/accountServer";
import { getTranslator } from "@/lib/i18n";
import { runtimeConfig } from "@/lib/runtime";

/** The bar at the top of every page: who this is, where to go, which language, who is signed in. */
export function SiteHeader({
  language,
  config,
  account,
}: {
  language: string;
  config: PublicConfig | null;
  account: Account | null;
}) {
  const logo = config?.has_logo ? `${runtimeConfig().apiUrl}/api/branding/logo?v=${config.logo_version ?? 0}` : null;

  return (
    <HeaderBar
      language={language}
      businessName={config?.business_name ?? ""}
      logo={logo}
      bookingEnabled={Boolean(config?.storefront_enabled)}
      account={account ? { first_name: account.first_name } : null}
    />
  );
}

export function SiteFooter({
  language,
  config,
  locations,
  signedIn,
}: {
  language: string;
  config: PublicConfig | null;
  locations: PublicLocation[];
  signedIn: boolean;
}) {
  const t = getTranslator(language);

  if (!config?.storefront_enabled) return null;

  const socials = [
    { label: "Instagram", href: config.social_instagram_url, Icon: InstagramIcon },
    { label: "Facebook", href: config.social_facebook_url, Icon: FacebookIcon },
    { label: "X", href: config.social_x_url, Icon: XIcon },
    { label: "WhatsApp", href: config.social_whatsapp_url, Icon: WhatsAppIcon },
  ].filter((social) => social.href.trim());

  const heading = "text-sm font-semibold text-on-deep";
  const item = "text-sm text-on-deep-muted hover:text-on-deep";

  return (
    <footer className="bg-deep text-on-deep">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <p className="text-lg font-semibold">{config.business_name}</p>
            <p className="mt-3 max-w-xs text-sm text-on-deep-muted">{t("footer.tagline")}</p>
          </div>

          <nav aria-label={t("footer.explore")}>
            <p className={heading}>{t("footer.explore")}</p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link href={`/${language}/fleet`} className={item}>
                  {t("nav.fleet")}
                </Link>
              </li>
              <li>
                <Link href={`/${language}/${signedIn ? "account" : "manage"}`} className={item}>
                  {t("nav.manage")}
                </Link>
              </li>
              {!signedIn && (
                <>
              <li>
                <Link href={`/${language}/login`} className={item}>
                  {t("nav.login")}
                </Link>
              </li>
              <li>
                <Link href={`/${language}/register`} className={item}>
                  {t("nav.register")}
                </Link>
              </li>
                </>
              )}
            </ul>
          </nav>

          <div>
            <p className={heading}>{t("footer.locations")}</p>
            <ul className="mt-4 space-y-2.5">
              {locations.map((location) => (
                <li key={location.id} className="text-sm text-on-deep-muted">
                  {location.name}
                </li>
              ))}
            </ul>
          </div>

          <nav aria-label={t("footer.legal")}>
            <p className={heading}>{t("footer.legal")}</p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link href={`/${language}/terms`} className={item}>
                  {t("footer.terms")}
                </Link>
              </li>
              <li>
                <Link href={`/${language}/privacy`} className={item}>
                  {t("footer.privacy")}
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <p className="text-xs text-on-deep-muted">
            {t("footer.rights", { year: new Date().getFullYear(), name: config.business_name })}
          </p>

          {socials.length > 0 && (
            <ul className="flex gap-3" aria-label={t("footer.social")}>
              {socials.map(({ label, href, Icon }) => (
                <li key={label}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-on-deep transition-colors hover:bg-white hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </footer>
  );
}
