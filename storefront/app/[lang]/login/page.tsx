import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AuthForm } from "@/components/AuthForm";
import { getAccount } from "@/lib/accountServer";
import { getTranslator } from "@/lib/i18n";
import { getPublicConfig } from "@/lib/publicApi";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;

  return { title: getTranslator(lang)("auth.loginTitle"), robots: { index: false, follow: false } };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { lang } = await params;
  const { next } = await searchParams;
  const config = await getPublicConfig();

  if (!config?.storefront_enabled) notFound();

  // Already signed in: nothing to do here.
  if (await getAccount()) redirect(`/${lang}/account`);

  return (
    <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <AuthForm mode="login" language={lang} next={next} />
    </main>
  );
}
