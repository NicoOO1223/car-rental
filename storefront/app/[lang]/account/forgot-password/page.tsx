import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { getAccount } from "@/lib/accountServer";
import { getTranslator } from "@/lib/i18n";
import { getPublicConfig } from "@/lib/publicApi";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;

  return { title: getTranslator(lang)("accountMail.forgotTitle"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const config = await getPublicConfig();

  if (!config?.storefront_enabled) notFound();

  if (await getAccount()) redirect(`/${lang}/account`);

  return (
    <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <ForgotPasswordForm language={lang} />
    </main>
  );
}
