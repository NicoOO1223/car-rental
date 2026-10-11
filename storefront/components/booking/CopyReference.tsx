"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

/**
 * An icon button that copies the booking reference. Browsers can refuse clipboard
 * access (an insecure page, a blocked permission); then nothing happens and the
 * reference is still there on screen to select. The change to a tick is announced
 * to screen readers through the live region.
 */
export function CopyReference({ value }: { value: string }) {
  const t = useTranslations("booking");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }

    setCopied(true);

    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  }

  const label = copied ? t("referenceCopied") : t("copyReference");

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={label}
      aria-label={label}
      aria-live="polite"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
    >
      {copied ? <Check className="h-5 w-5 text-ink" aria-hidden="true" /> : <Copy className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}
