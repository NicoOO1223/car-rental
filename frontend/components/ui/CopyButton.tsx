"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * An icon button that copies a value. The words are passed in (this is a shared
 * piece, so the caller owns the wording); the change to a tick is announced to
 * screen readers through the live region.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  compact = false,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  /** A smaller target, for a tight row. */
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the value is on screen to select.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={copied ? copiedLabel : label}
      aria-label={copied ? copiedLabel : label}
      aria-live="polite"
      className={`flex shrink-0 items-center justify-center rounded-md ${compact ? "h-5 w-5" : "h-7 w-7"} text-ink-muted transition hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink`}
    >
      {copied ? (
        <Check className={`${compact ? "h-3 w-3" : "h-3.5 w-3.5"} text-success`} aria-hidden="true" />
      ) : (
        <Copy className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden="true" />
      )}
    </button>
  );
}
