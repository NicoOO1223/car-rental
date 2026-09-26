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
        if (!cancelled) setError("Failed to load customers.");
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
      header: "Customer",
      mobile: "primary",
      cell: (customer) => (
        <div className="flex items-center gap-2">
          <TwoLine
            primary={`${customer.first_name} ${customer.last_name}`}
            secondary={customer.postal_code}
          />
          {customer.anonymized_at && (
            <Badge colorClass="bg-gray-100 text-gray-600">Erased</Badge>
          )}
        </div>
      ),
      mobileCell: (customer) =>
        `${customer.first_name} ${customer.last_name}`,
    },
    {
      id: "reservations",
      header: "Reservations",
      mobile: "trailing",
      cell: (customer) => (
        <span className="font-medium tabular-nums">
          {customer.reservation_count}
        </span>
      ),
      mobileCell: (customer) => (
        <span className="text-sm font-medium text-ink">
          {customer.reservation_count}
          <span className="font-normal text-ink-muted">
            {" "}
            booking{customer.reservation_count === 1 ? "" : "s"}
          </span>
        </span>
      ),
    },
    {
      id: "last_booking",
      header: "Last booking",
      mobileLabel: "Last booking",
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
      header: "Customer since",
      mobileLabel: "Customer since",
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
          <p className="text-red-600" role="alert">
            {error}
          </p>

          <Button className="mt-4" onClick={refreshCustomers}>
            Try again
          </Button>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Customers"
        description="Everyone who has booked a vehicle, most recent booking first."
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
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      <StatTileGrid columns={5} className="mb-8">
        <StatTile label="Total customers" value={summary?.total ?? "–"} />
        <StatTile label="New this week" value={summary?.new_this_week ?? "–"} />
        <StatTile
          label="Repeat customers"
          value={summary?.repeat_customers ?? "–"}
        />
        <StatTile
          label="Total reservations"
          value={summary?.total_reservations ?? "–"}
        />
        <StatTile
          label="Avg. reservations"
          value={summary ? summary.avg_reservations.toFixed(1) : "–"}
        />
      </StatTileGrid>

      <Toolbar
        footer={
          <>
            <p>
              <span className="font-medium text-ink">{total}</span>{" "}
              {isFiltered ? "matching customers" : "customers"}
            </p>

            {isFiltered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </>
        }
      >
        <Field label="Search" className="sm:col-span-2">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="search"
              value={filters.q}
              onChange={(event) => updateFilters({ q: event.target.value })}
              placeholder="Name, email, phone or address..."
            />
          )}
        </Field>

        <Field label="Segment">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.segment}
              onChange={(event) => updateFilters({ segment: event.target.value })}
            >
              <option value="ALL">All customers</option>
              <option value="NEW_THIS_WEEK">New this week</option>
              <option value="REPEAT">Repeat customers</option>
            </Select>
          )}
        </Field>

        <Field label="Sort by">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.sort}
              onChange={(event) => updateFilters({ sort: event.target.value })}
            >
              <option value="recent">Most recent booking</option>
              <option value="name">Name, A to Z</option>
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
          title: isFiltered ? "No customers match" : "No customers yet",
          description: isFiltered
            ? "Try changing your search or segment."
            : "Customers appear here once they have booked a vehicle.",
          action: isFiltered ? (
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
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
