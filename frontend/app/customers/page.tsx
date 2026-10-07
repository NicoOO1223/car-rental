"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Users } from "lucide-react";

import {
  getCustomers,
  getCustomerSummary,
  type CustomerListItem,
  type CustomerSummaryStats,
} from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { Pagination } from "@/components/ui/Pagination";
import { Toolbar } from "@/components/ui/Toolbar";
import { formatDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useNavigate } from "@/lib/useNavigate";
import { useUrlFilters } from "@/lib/useUrlFilters";
import { t } from "@/lib/i18n";

const FILTER_DEFAULTS = {
  q: "",
  segment: "ALL",
  sort: "recent",
  page: "1",
};

const PAGE_SIZE = 25;

export default function CustomersPage() {
  const navigate = useNavigate();
  const { filters, setFilters, clearFilters, isFiltered } =
    useUrlFilters(FILTER_DEFAULTS);

  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<CustomerSummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Bumped by "Refresh" and "Try again" to re-run the loader effect.
  const [reloadKey, setReloadKey] = useState(0);

  const page = Number(filters.page) || 1;
  // The URL updates on every keystroke; the server is only asked once
  // typing pauses.
  const search = useDebouncedValue(filters.q);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [list, stats] = await Promise.all([
          getCustomers({
            q: search,
            segment: filters.segment === "ALL" ? undefined : filters.segment,
            sort: filters.sort,
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
          }),
          getCustomerSummary(),
        ]);

        if (cancelled) return;
        setCustomers(list.items);
        setTotal(list.total);
        setSummary(stats);
      } catch {
        if (!cancelled) setError(t("s.customers.failedLoadCustomers"));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [search, filters.segment, filters.sort, page, reloadKey]);

  function refreshCustomers() {
    setRefreshing(true);
    setReloadKey((key) => key + 1);
  }

  // Any filter change goes back to the first page.
  function updateFilters(patch: Partial<typeof filters>) {
    setFilters({ ...patch, page: "1" });
  }

  const columns: Column<CustomerListItem>[] = [
    {
      id: "name",
      header: t("s.customers.customer"),
      mobile: "primary",
      cell: (customer) => (
        <div className="flex items-center gap-2">
          <TwoLine
            primary={`${customer.first_name} ${customer.last_name}`}
            secondary={customer.postal_code}
          />
          {customer.anonymized_at && (
            <Badge colorClass="bg-surface-sunken text-ink-secondary">{t("s.customers.erased")}</Badge>
          )}
        </div>
      ),
      mobileCell: (customer) =>
        `${customer.first_name} ${customer.last_name}`,
    },
    {
      id: "reservations",
      header: t("s.customers.reservations"),
      mobile: "trailing",
      cell: (customer) => (
        <span className="font-medium tabular-nums">
          {customer.reservation_count}
        </span>
      ),
      mobileCell: (customer) => (
        <span className="text-sm font-medium text-ink">
          {t("common.bookings", { count: customer.reservation_count })}
        </span>
      ),
    },
    {
      id: "last_booking",
      header: t("s.customers.lastBooking"),
      mobileLabel: t("s.customers.lastBooking"),
      cell: (customer) =>
        customer.last_reservation_at
          ? formatDate(customer.last_reservation_at)
          : "—",
      sortAccessor: (customer) =>
        customer.last_reservation_at
          ? new Date(customer.last_reservation_at)
          : null,
    },
    {
      id: "created",
      header: t("s.customers.customerSince"),
      mobileLabel: t("s.customers.customerSince"),
      cell: (customer) => (
        <span className="text-sm text-ink-muted">
          {formatDate(customer.created_at)}
        </span>
      ),
    },
  ];

  if (error) {
    return (
      <PageShell>
        <Card>
          <p className="text-danger" role="alert">
            {error}
          </p>

          <Button className="mt-4" onClick={refreshCustomers}>{t("s.customers.tryAgain")}</Button>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={t("s.customers.customers")}
        description={t("s.customers.everyoneWhoHasBooked")}
        actions={
          <Button
            variant="secondary"
            onClick={refreshCustomers}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {refreshing ? t("s.customers.refreshing") : t("s.customers.refresh")}
          </Button>
        }
      />

      <StatTileGrid columns={5} className="mb-8">
        <StatTile label={t("s.customers.totalCustomers")} value={summary?.total ?? "–"} />
        <StatTile label={t("s.customers.newWeek")} value={summary?.new_this_week ?? "–"} />
        <StatTile
          label={t("s.customers.repeatCustomers")}
          value={summary?.repeat_customers ?? "–"}
        />
        <StatTile
          label={t("s.customers.totalReservations")}
          value={summary?.total_reservations ?? "–"}
        />
        <StatTile
          label={t("s.customers.avgReservations")}
          value={summary ? summary.avg_reservations.toFixed(1) : "–"}
        />
      </StatTileGrid>

      <Toolbar
        footer={
          <>
            <p>
              {t(isFiltered ? "s.customers.matchingCount" : "s.customers.totalCount", { count: total })}
            </p>

            {isFiltered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>{t("s.customers.clearFilters")}</Button>
            )}
          </>
        }
      >
        <Field label={t("s.customers.search")} className="sm:col-span-2">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="search"
              value={filters.q}
              onChange={(event) => updateFilters({ q: event.target.value })}
              placeholder={t("s.customers.nameEmailPhoneAddress")}
            />
          )}
        </Field>

        <Field label={t("s.customers.segment")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.segment}
              onChange={(event) => updateFilters({ segment: event.target.value })}
            >
              <option value="ALL">{t("s.customers.allCustomers")}</option>
              <option value="NEW_THIS_WEEK">{t("s.customers.newWeek")}</option>
              <option value="REPEAT">{t("s.customers.repeatCustomers")}</option>
            </Select>
          )}
        </Field>

        <Field label={t("s.customers.sortBy")}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.sort}
              onChange={(event) => updateFilters({ sort: event.target.value })}
            >
              <option value="recent">{t("s.customers.mostRecentBooking")}</option>
              <option value="name">{t("s.customers.nameZ")}</option>
            </Select>
          )}
        </Field>
      </Toolbar>

      <DataTable
        rows={customers}
        columns={columns}
        rowKey={(customer) => customer.id}
        loading={loading}
        onRowClick={(customer) => navigate(`/customers/${customer.id}`)}
        empty={{
          icon: Users,
          title: isFiltered ? t("s.customers.noCustomersMatch") : t("s.customers.noCustomersYet"),
          description: isFiltered
            ? t("s.customers.tryChangingSearchSegment")
            : t("s.customers.customersAppearHereOnce"),
          action: isFiltered ? (
            <Button variant="secondary" onClick={clearFilters}>{t("s.customers.clearFilters")}</Button>
          ) : undefined,
        }}
      />

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={(next) => setFilters({ page: String(next) })}
      />
    </PageShell>
  );
}
