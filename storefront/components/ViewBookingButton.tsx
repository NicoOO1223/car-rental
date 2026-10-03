"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { accountApi } from "@/lib/account";
import { errorMessage } from "@/lib/errors";
import { manageToken } from "@/lib/session";

/** Opens one of the account's own bookings. No email needed: the account already proves who they are. */
export function ViewBookingButton({ language, reference }: { language: string; reference: string }) {
  const t = useTranslations("account");
  const all = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setBusy(true);
    setError("");

    try {
      const access = await accountApi.access(reference);

      manageToken.set(reference, access.manage_token);
      router.push(`/${language}/booking/${encodeURIComponent(reference)}`);
    } catch (failure) {
      setError(errorMessage(all, failure));
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="w-full rounded-xl border border-border-strong px-4 py-2.5 text-center text-sm font-semibold hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 disabled:opacity-50"
      >
        {t("view")}
      </button>

      {error && (
        <p className="mt-2 max-w-48 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
