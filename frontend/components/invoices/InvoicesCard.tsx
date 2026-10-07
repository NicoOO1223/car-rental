"use client";

import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";

import {
  downloadInvoice,
  getReservationInvoices,
  type Invoice,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The tax documents issued for a booking: an invoice when the rental was
 * paid, and a credit note if it was refunded. Shows nothing until the first
 * one exists, so an unpaid booking has no empty panel.
 *
 * `refreshKey` is anything that changes when a payment does (the payment
 * status), so the list follows a payment or refund without a page reload.
 */
export function InvoicesCard({
  reservationId,
  refreshKey = "",
}: {
  reservationId: string;
  refreshKey?: string;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getReservationInvoices(reservationId)
      .then((data) => {
        if (!cancelled) setInvoices(data);
      })
      // Documents are secondary to the page; a failure just hides them.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [reservationId, refreshKey]);

  async function handleDownload(invoice: Invoice) {
    setBusyId(invoice.id);
    setError("");

    try {
      await downloadInvoice(invoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("c.invoices.InvoicesCard.failedDownload"));
    } finally {
      setBusyId(null);
    }
  }

  if (invoices.length === 0) return null;

  return (
    <section className="rounded-xl bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{t("c.invoices.InvoicesCard.invoices")}</h2>

      <ul className="mt-4 divide-y divide-border-subtle">
        {invoices.map((invoice) => (
          <li
            key={invoice.id}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <FileText
                className="h-5 w-5 shrink-0 text-ink-muted"
                aria-hidden="true"
              />

              <div className="min-w-0">
                <p className="truncate font-medium text-ink">
                  {invoice.number}
                  {invoice.kind === "CREDIT_NOTE" && (
                    <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-secondary">{t("c.invoices.InvoicesCard.creditNote")}</span>
                  )}
                </p>

                <p className="text-sm text-ink-muted">
                  {formatDate(invoice.issued_at)} ·{" "}
                  {formatCurrency(invoice.total_amount, invoice.currency.toUpperCase())}
                  {invoice.vat_rate > 0 && (
                    <>{t("c.invoices.InvoicesCard.vat", { amount: formatCurrency(invoice.vat_amount, invoice.currency.toUpperCase()) })}</>
                  )}
                </p>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              loading={busyId === invoice.id}
              disabled={busyId !== null}
              onClick={() => handleDownload(invoice)}
            >
              <Download className="h-4 w-4" aria-hidden="true" />{t("c.invoices.InvoicesCard.pdf")}</Button>
          </li>
        ))}
      </ul>

      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
