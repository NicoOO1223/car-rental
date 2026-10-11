"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import { api } from "@/lib/client";
import { anyToken, pendingBooking } from "@/lib/session";

type Outcome = "checking" | "slow" | "refunded" | "failed";

const ATTEMPTS = 20;
const WAIT_MS = 3000;

const primary =
  "rounded-lg bg-accent px-5 py-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2";

/**
 * Where the payment form sends the renter afterwards. It asks the server what
 * Stripe says (the server does not trust the browser), and waits a little for a
 * payment that is still being processed, then moves on to the booking.
 */
export function ReturnStatus({ language }: { language: string }) {
  const t = useTranslations("returnPage");
  const router = useRouter();
  const reference = useSearchParams().get("reference") ?? "";
  const [outcome, setOutcome] = useState<Outcome>("checking");

  useEffect(() => {
    const token = anyToken(reference);

    if (!reference || !token) {
      router.replace(`/${language}/manage${reference ? `?reference=${encodeURIComponent(reference)}` : ""}`);
      return;
    }

    let cancelled = false;

    async function check(attempt: number) {
      try {
        const status = await api.syncPayment(reference, token as string);

        if (cancelled) return;

        if (status.status === "CONFIRMED" || status.status === "ACTIVE") {
          pendingBooking.clear();
          router.replace(`/${language}/booking/${encodeURIComponent(reference)}?confirmed=1`);
          return;
        }

        if (status.payment_status === "REFUNDED") return setOutcome("refunded");
        if (["EXPIRED", "CANCELLED"].includes(status.status) || status.payment_status === "FAILED") return setOutcome("failed");
      } catch {
        // A hiccup: try again below.
      }

      if (attempt + 1 >= ATTEMPTS) return setOutcome("slow");

      window.setTimeout(() => !cancelled && check(attempt + 1), WAIT_MS);
    }

    check(0);

    return () => {
      cancelled = true;
    };
  }, [reference, language, router]);

  const messages: Record<Outcome, [string, string]> = {
    checking: [t("checkingTitle"), t("checkingBody")],
    slow: [t("slowTitle"), t("slowBody")],
    refunded: [t("refundedTitle"), t("refundedBody")],
    failed: [t("failedTitle"), t("failedBody")],
  };

  const [title, body] = messages[outcome];

  return (
    <section className="rounded-xl bg-surface p-6 shadow-sm" role="status" aria-live="polite">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-ink-secondary">{body}</p>

      {outcome === "slow" && (
        <Link href={`/${language}/manage?reference=${encodeURIComponent(reference)}`} className={`${primary} mt-5 inline-block`}>
          {t("lookup")}
        </Link>
      )}

      {(outcome === "refunded" || outcome === "failed") && (
        <Link href={`/${language}`} className={`${primary} mt-5 inline-block`}>
          {t("search")}
        </Link>
      )}
    </section>
  );
}
