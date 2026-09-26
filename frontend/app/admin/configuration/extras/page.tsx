"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";

import {
  getAdminExtras,
  reorderExtras,
  updateExtra,
  type AdminExtra,
} from "@/lib/api";
import { ExtraModal } from "@/components/admin/ExtraModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatCurrency } from "@/lib/format";
import { extraDescription, extraName } from "@/lib/extras";
import { t } from "@/lib/i18n";

export default function ExtrasConfigurationPage() {
  const [extras, setExtras] = useState<AdminExtra[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminExtra | "new" | null>(null);

  const refresh = useCallback(async () => {
    try {
      setExtras(await getAdminExtras());
    } catch {
      setError(t("s.admin.configuration.extras.failedLoadExtras"));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    getAdminExtras()
      .then((data) => {
        if (!cancelled) setExtras(data);
      })
      .catch(() => {
        if (!cancelled) setError(t("s.admin.configuration.extras.failedLoadExtras"));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleActive(extra: AdminExtra) {
    setBusyId(extra.id);
    setError("");

    try {
      await updateExtra(extra.id, { is_active: !extra.is_active });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.extras.failedUpdateExtra"));
    } finally {
      setBusyId(null);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!extras) return;

    const target = index + direction;

    if (target < 0 || target >= extras.length) return;

    const ids = extras.map((extra) => extra.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];

    setBusyId(extras[index].id);
    setError("");

    try {
      setExtras(await reorderExtras(ids));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("s.admin.configuration.extras.failedReorderExtras"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{t("s.admin.configuration.extras.extras")}</h2>

            <p className="mt-1 text-sm text-ink-secondary">{t("s.admin.configuration.extras.addOnsCustomersCan")}</p>
          </div>

          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />{t("s.admin.configuration.extras.addExtra")}</Button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {!extras ? (
          !error && <p className="mt-6 text-ink-secondary">{t("s.admin.configuration.extras.loadingExtras")}</p>
        ) : (
          <ul className="mt-6 divide-y divide-border-subtle">
            {extras.map((extra, index) => (
              <li
                key={extra.id}
                className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between ${
                  extra.is_active ? "" : "opacity-60"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {extraName(extra)}
                    {!extra.is_active && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">{t("s.admin.configuration.extras.retired")}</span>
                    )}
                  </p>

                  {extraDescription(extra) && (
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {extraDescription(extra)}
                    </p>
                  )}

                  <p className="mt-1 text-sm text-ink-secondary">{t(extra.price_unit === "PER_DAY" ? "s.admin.configuration.extras.pricePerDay" : "s.admin.configuration.extras.priceOnce", { price: formatCurrency(extra.price), max_quantity: extra.max_quantity })}</p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label={t("s.admin.configuration.extras.moveUp", { name: extraName(extra) })}
                    disabled={index === 0 || busyId !== null}
                    onClick={() => move(index, -1)}
                    className="rounded-md p-1.5 text-ink-secondary transition hover:bg-surface-sunken hover:text-ink disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    aria-label={t("s.admin.configuration.extras.moveDown", { name: extraName(extra) })}
                    disabled={index === extras.length - 1 || busyId !== null}
                    onClick={() => move(index, 1)}
                    className="rounded-md p-1.5 text-ink-secondary transition hover:bg-surface-sunken hover:text-ink disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>

                  <Button variant="secondary" onClick={() => setEditing(extra)}>{t("s.admin.configuration.extras.edit")}</Button>

                  <Button
                    variant="ghost"
                    onClick={() => toggleActive(extra)}
                    disabled={busyId === extra.id}
                  >
                    {extra.is_active ? t("s.admin.configuration.extras.retire") : t("s.admin.configuration.extras.reactivate")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <ExtraModal
          extra={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
