import Link from "next/link";

import { brand, isTodo } from "@/content/brand";
import { getTranslator } from "@/lib/i18n";
import { contactEmail, href } from "@/lib/links";

import { buttonClass } from "./Button";
import { Logo } from "./Logo";
import { MobileMenu } from "./MobileMenu";

export function SiteHeader({ language }: { language: string }) {
  const t = getTranslator(language);
  const home = href(language, "/");
  const items = [
    { href: `${home}#features`, label: t("nav.features") },
    { href: `${home}#how-it-works`, label: t("nav.how") },
    { href: `${home}#pricing`, label: t("nav.pricing") },
    { href: `${home}#faq`, label: t("nav.faq") },
  ];

  return (
    <header className="sticky top-0 z-40 bg-deep text-on-deep">
      <div className="relative mx-auto flex h-16 max-w-300 items-center justify-between gap-4 px-4">
        <Link href={home} aria-label={t("nav.home", { brand: brand.name })} className="text-on-deep">
          <Logo />
        </Link>

        <nav aria-label={t("nav.main")} className="hidden md:block">
          <ul className="flex items-center gap-7 text-base">
            {items.map((item) => (
              <li key={item.href}>
                <a href={item.href} className="text-on-deep-muted transition hover:text-on-deep">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Link href={href(language, "/demo")} className={buttonClass("accent", "px-4")}>
            {t("nav.cta")}
          </Link>
          <MobileMenu items={items} menuLabel={t("nav.menu")} closeLabel={t("nav.close")} />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ language }: { language: string }) {
  const t = getTranslator(language);
  const email = contactEmail();
  const { legal } = brand;
  const entityKnown = !isTodo(legal.entity);

  return (
    <footer className="bg-deep text-on-deep-muted">
      <div className="mx-auto grid max-w-300 gap-8 px-4 py-12 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <Logo className="text-on-deep" />
          <p className="mt-3 max-w-xs text-base">{t("footer.tagline")}</p>
        </div>

        <ul className="space-y-2 text-base">
          <li>
            <Link href={href(language, "/privacy")} className="hover:text-on-deep">
              {t("footer.privacy")}
            </Link>
          </li>
          <li>
            <Link href={href(language, "/terms")} className="hover:text-on-deep">
              {t("footer.terms")}
            </Link>
          </li>
          <li>
            {email ? (
              <a href={`mailto:${email}`} className="hover:text-on-deep">
                {email}
              </a>
            ) : (
              <span>{t("footer.contactPending")}</span>
            )}
          </li>
        </ul>

        <address className="text-base not-italic">
          {entityKnown ? (
            <>
              <p className="text-on-deep">{t("footer.rights", { year: new Date().getFullYear(), entity: legal.entity })}</p>
              {!isTodo(legal.address) && <p>{legal.address}</p>}
              {!isTodo(legal.vatId) && <p>{legal.vatId}</p>}
            </>
          ) : (
            <p>{t("footer.legalPending")}</p>
          )}
        </address>
      </div>
    </footer>
  );
}
