"use client";

import { useEffect, useState } from "react";

import {
  getAuditLogActors,
  getAuditLogs,
  type AuditLogActor,
  type AuditLogEntry,
} from "@/lib/api";
import { AuditLogFeed } from "@/components/audit-log/AuditLogFeed";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Pagination } from "@/components/ui/Pagination";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { Toolbar } from "@/components/ui/Toolbar";
import { Button } from "@/components/ui/Button";
import { useUrlFilters } from "@/lib/useUrlFilters";

const PAGE_SIZE = 25;

// No backend endpoint enumerates these — they're the fixed set of
// entity types and actions app/services/audit.py currently writes.
// Update this list by hand if a future layer adds a new audited action.
const ENTITY_TYPES = ["reservation", "customer", "handover", "check_out", "car", "extra", "user", "configuration", "maintenance_task"];
const ACTIONS = [
  "reservation.cancelled",
  "reservation.status_changed",
  "customer.updated",
  "customer.viewed",
  "customer.identity_verification_updated",
  "customer.identity_details_updated",
  "customer.identity_details_viewed",
  "customer.anonymized",
  "customer.data_exported",
  "handover.payment_confirmed",
  "handover.agreement_generated",
  "handover.employee_signed",
  "check_out.condition_recorded",
  "check_out.charge_waived",
  "check_out.payment_confirmed",
  "check_out.employee_signed",
  "check_out.completed",
  "car.relocated",
  "car.price_updated",
  "extra.created",
  "extra.updated",
  "extra.retired",
  "extra.reactivated",
  "extra.reordered",
  "handover.refund_issued",
  "user.created",
  "user.role_changed",
  "user.activated",
  "user.deactivated",
  "user.email_changed",
  "user.password_reset",
  "user.visibility_changed",
  "configuration.updated",
  "maintenance_task.created",
  "maintenance_task.completed",
  "maintenance_task.cancelled",
];

const FILTER_DEFAULTS = {
  entity_type: "ALL",
  action: "ALL",
  user_id: "ALL",
  start_date: "",
  end_date: "",
  page: "1",
};

export default function AuditLogPage() {
  const { filters, setFilters, clearFilters, isFiltered } =
    useUrlFilters(FILTER_DEFAULTS);

  const [actors, setActors] = useState<AuditLogActor[]>([]);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const page = Number(filters.page) || 1;

  useEffect(() => {
    getAuditLogActors()
      .then(setActors)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadEntries() {
      setLoading(true);
      setError("");

      try {
        const response = await getAuditLogs({
          entityType: filters.entity_type === "ALL" ? undefined : filters.entity_type,
          action: filters.action === "ALL" ? undefined : filters.action,
          userId: filters.user_id === "ALL" ? undefined : filters.user_id,
          startDate: filters.start_date || undefined,
          endDate: filters.end_date || undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        });

        if (cancelled) return;
        setEntries(response.items);
        setTotal(response.total);
      } catch {
        if (!cancelled) setError("Failed to load audit log.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEntries();

    return () => {
      cancelled = true;
    };
  }, [
    filters.entity_type,
    filters.action,
    filters.user_id,
    filters.start_date,
    filters.end_date,
    page,
  ]);

  function updateFilter(patch: Partial<typeof filters>) {
    setFilters({ ...patch, page: "1" });
  }

  if (error) {
    return (
      <PageShell>
        <Card>
          <p className="text-red-600" role="alert">
            {error}
          </p>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Audit Log"
        description="Every recorded action across the platform, most recent first."
      />

      <Toolbar
        footer={
          isFiltered ? (
            <Button variant="ghost" size="sm" onClick={() => clearFilters()}>
              Clear filters
            </Button>
          ) : undefined
        }
      >
        <Field label="Entity type">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.entity_type}
              onChange={(event) => updateFilter({ entity_type: event.target.value })}
            >
              <option value="ALL">All entities</option>
              {ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Action">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.action}
              onChange={(event) => updateFilter({ action: event.target.value })}
            >
              <option value="ALL">All actions</option>
              {ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="User">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.user_id}
              onChange={(event) => updateFilter({ user_id: event.target.value })}
            >
              <option value="ALL">All users</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.email}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="date"
                value={filters.start_date}
                onChange={(event) => updateFilter({ start_date: event.target.value })}
              />
            )}
          </Field>

          <Field label="To">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="date"
                value={filters.end_date}
                onChange={(event) => updateFilter({ end_date: event.target.value })}
              />
            )}
          </Field>
        </div>
      </Toolbar>

      <AuditLogFeed entries={entries} loading={loading} isFiltered={isFiltered} />

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={(next) => setFilters({ page: String(next) })}
      />
    </PageShell>
  );
}
