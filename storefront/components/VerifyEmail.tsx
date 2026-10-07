"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import { accountApi } from "@/lib/account";
import { errorMessage } from "@/lib/errors";

/** The page the confirmation email links to. The token is in the address fragment, so it is never sent to a server by the browser. */
export function VerifyEmail({ language }: { language: string }) {
  const t = useTranslations("accountMail");
  const all = useTranslations();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");

    // Take the token out of the address bar and the history.
    window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      setState("failed");
      setMessage(t("linkMissing"));

      return;
    }

    accountApi
      .verifyEmail(token)
      .then(() => setState("done"))
      .catch((failure) => {
        setState("failed");
        setMessage(errorMessage(all, failure));
      });
    // The page runs once, for the link it was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm sm:p-8" role="status">
      <h1 className="text-2xl font-bold tracking-tight">
        {state === "working" ? t("verifying") : state === "done" ? t("verifiedTitle") : t("verifyFailedTitle")}
      </h1>

      {state === "done" && <p className="mt-3 text-ink-secondary">{t("verifiedBody")}</p>}
      {state === "failed" && <p className="mt-3 text-ink-secondary">{message}</p>}

      {state !== "working" && (
        <Link
          href={`/${language}/${state === "done" ? "account" : "login"}`}
          className="mt-6 inline-block rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          {state === "done" ? t("toAccount") : t("toLogin")}
        </Link>
      )}
    </div>
  );
}
