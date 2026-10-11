"use client";

import { useState } from "react";
import { Banknote, Check, ClockPlus, Copy, Hourglass, Landmark, Link2, Send } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";

export type AdvanceAction = "cash" | "transfer" | "resend" | "extend" | "link";

type Props = {
  /** What was asked of the renter, as a decimal string. */
  amount: string;
  /** When the advance has to be paid by (ISO), and the time zone to show it in. */
  deadline: string | null;
  timeZone: string;
  canWrite: boolean;
  /** The action in flight, so its button shows the spinner and the rest wait. */
  busy: AdvanceAction | null;
  /** The renter's payment link once it has been fetched. */
  link: string;
  onAction: (action: AdvanceAction) => void;
};

/**
 * An approved booking waiting for its advance. Reads top to bottom as the staff
 * member would think: what is owed and by when; I have the money (the one
 * decision that confirms the booking, so each way gets its own full-width row);
 * and the smaller things to do about the request itself, side by side.
 */
export function AdvancePaymentPanel({ amount, deadline, timeZone, canWrite, busy, link, onAction }: Props) {
  const [copied, setCopied] = useState(false);
  const locked = !canWrite || busy !== null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The field is selectable; nothing more to do if the browser refuses.
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-warning-line bg-warning-soft p-4 text-warning">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface" aria-hidden="true">
          <Hourglass className="h-5 w-5" />
        </span>

        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("s.reservations.manage.id.advanceWaiting")}</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">{formatCurrency(amount)}</p>
          {deadline && (
            <p className="mt-1 text-sm">
              {t("s.reservations.manage.id.advanceDueBy", {
                date: formatDate(deadline, timeZone),
                time: formatTime(deadline, timeZone),
              })}
            </p>
          )}
          <p className="mt-0.5 text-xs">{t("s.reservations.manage.id.advanceHeld")}</p>
        </div>
      </div>

      <section aria-labelledby="advance-record">
        <h3 id="advance-record" className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {t("s.reservations.manage.id.recordAdvanceTitle")}
        </h3>

        <div className="mt-2 space-y-2">
          <Button
            variant="secondary"
            fullWidth
            className="justify-start"
            disabled={locked}
            loading={busy === "cash"}
            onClick={() => onAction("cash")}
          >
            {busy !== "cash" && <Banknote className="h-4 w-4 text-ink-muted" aria-hidden="true" />}
            {t("s.reservations.manage.id.advanceInCash")}
          </Button>

          <Button
            variant="secondary"
            fullWidth
            className="justify-start"
            disabled={locked}
            loading={busy === "transfer"}
            onClick={() => onAction("transfer")}
          >
            {busy !== "transfer" && <Landmark className="h-4 w-4 text-ink-muted" aria-hidden="true" />}
            {t("s.reservations.manage.id.advanceByTransfer")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="advance-request">
        <h3 id="advance-request" className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {t("s.reservations.manage.id.requestTitle")}
        </h3>

        <div className="mt-2 grid grid-cols-3 gap-2">
          {(
            [
              ["resend", Send, "s.reservations.manage.id.resendShort", "s.reservations.manage.id.resendRequest"],
              ["extend", ClockPlus, "s.reservations.manage.id.extendShort", "s.reservations.manage.id.extendWindow"],
              ["link", Link2, "s.reservations.manage.id.linkShort", "s.reservations.manage.id.showLink"],
            ] as const
          ).map(([action, Icon, label, longLabel]) => (
            <Button
              key={action}
              variant="ghost"
              className="h-auto flex-col gap-1 rounded-lg border border-border-subtle px-1 py-2.5 text-xs"
              disabled={action === "link" ? busy !== null : locked}
              loading={busy === action}
              title={t(longLabel)}
              aria-label={t(longLabel)}
              onClick={() => onAction(action)}
            >
              {busy !== action && <Icon className="h-4 w-4" aria-hidden="true" />}
              <span>{t(label)}</span>
            </Button>
          ))}
        </div>

        {link && (
          <div className="mt-3 rounded-lg border border-border-strong bg-surface p-2">
            <label htmlFor="advance-link" className="sr-only">
              {t("s.reservations.manage.id.paymentLink")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="advance-link"
                readOnly
                value={link}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 truncate rounded-md bg-surface-sunken px-2 py-1.5 text-xs text-ink-secondary"
              />
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyLink()}>
                {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? t("s.reservations.manage.id.linkCopied") : t("s.reservations.manage.id.copyLink")}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
