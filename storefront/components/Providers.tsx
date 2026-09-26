"use client";

import { IntlProvider } from "use-intl";

import type { Messages } from "@/lib/i18n";

/** Hands the visitor language and its messages to every client component. */
export function Providers({
  language,
  messages,
  children,
}: {
  language: string;
  messages: Messages;
  children: React.ReactNode;
}) {
  return (
    <IntlProvider
      locale={language}
      messages={messages}
      onError={() => {}}
      getMessageFallback={({ namespace, key }) => (namespace ? `${namespace}.${key}` : key)}
    >
      {children}
    </IntlProvider>
  );
}
