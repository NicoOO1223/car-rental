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

export default function ExtrasConfigurationPage() {
  const [extras, setExtras] = useState<AdminExtra[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminExtra | "new" | null>(null);

  const refresh = useCallback(async () => {
    try {
      setExtras(await getAdminExtras());
    } catch {
      setError("Failed to load extras.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    getAdminExtras()
      .then((data) => {
        if (!cancelled) setExtras(data);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load extras.");
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
      setError(err instanceof Error ? err.message : "Failed to update the extra.");
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
      setError(err instanceof Error ? err.message : "Failed to reorder the extras.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Extras</h2>

            <p className="mt-1 text-sm text-ink-secondary">
              Add-ons customers can put on a booking. Changing a price only
              affects new bookings; retire an extra to stop selling it.
            </p>
          </div>

          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add extra
          </Button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {!extras ? (
          !error && <p className="mt-6 text-ink-secondary">Loading extras…</p>
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
                    {extra.name}
                    {!extra.is_active && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                        Retired
                      </span>
                    )}
                  </p>

                  {extra.description && (
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {extra.description}
                    </p>
                  )}

                  <p className="mt-1 text-sm text-ink-secondary">
                    {formatCurrency(extra.price)}{" "}
                    {extra.price_unit === "PER_DAY" ? "per day" : "once per rental"}{" "}
                    · up to {extra.max_quantity}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Move ${extra.name} up`}
                    disabled={index === 0 || busyId !== null}
                    onClick={() => move(index, -1)}
                    className="rounded-md p-1.5 text-ink-secondary transition hover:bg-surface-sunken hover:text-ink disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    aria-label={`Move ${extra.name} down`}
                    disabled={index === extras.length - 1 || busyId !== null}
                    onClick={() => move(index, 1)}
                    className="rounded-md p-1.5 text-ink-secondary transition hover:bg-surface-sunken hover:text-ink disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>

                  <Button variant="secondary" onClick={() => setEditing(extra)}>
                    Edit
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={() => toggleActive(extra)}
                    disabled={busyId === extra.id}
                  >
                    {extra.is_active ? "Retire" : "Reactivate"}
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
