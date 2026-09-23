"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Users } from "lucide-react";

import { getCustomers, type CustomerListItem } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { Toolbar } from "@/components/ui/Toolbar";
import { formatDate } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { useUrlFilters } from "@/lib/useUrlFilters";

const FILTER_DEFAULTS = {
  q: "",
  segment: "ALL",
};

function isWithinLastWeek(date: string) {
  const created = new Date(date);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  return created >= weekAgo;
}

export default function CustomersPage() {
  const navigate = useNavigate();
  const { filters, setFilters, clearFilters, isFiltered } =
    useUrlFilters(FILTER_DEFAULTS);

  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function refreshCustomers() {
    setRefreshing(true);
    setError("");

    try {
      setCustomers(await getCustomers());
    } catch {
      setError("Failed to load customers.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    async function loadCustomers() {
      try {
        setCustomers(await getCustomers());
      } catch {
        setError("Failed to load customers.");
      } finally {
        setLoading(false);
      }
    }

    loadCustomers();
  }, []);

  const statistics = useMemo(() => {
    const total = customers.length;
    const totalReservations = customers.reduce(
      (sum, customer) => sum + customer.reservation_count,
      0,
    );

    return {
      total,
      newThisWeek: customers.filter((customer) =>
        isWithinLastWeek(customer.created_at),
      ).length,
      repeatCustomers: customers.filter(
        (customer) => customer.reservation_count >= 2,
      ).length,
      totalReservations,
      avgReservations: total === 0 ? 0 : totalReservations / total,
    };
  }, [customers]);

  // The backend already sorts by most recent booking. This only filters;
  // any re-ordering is the table's own sort, which starts unsorted.
  const filteredCustomers = useMemo(() => {
    const searchValue = filters.q.toLowerCase().trim();

    return customers.filter((customer) => {
      if (searchValue) {
        const name =
          `${customer.first_name} ${customer.last_name}`.toLowerCase();

        const matches =
          name.includes(searchValue) ||
          customer.address.toLowerCase().includes(searchValue) ||
          customer.postal_code.toLowerCase().includes(searchValue);

        if (!matches) return false;
      }

      if (
        filters.segment === "NEW_THIS_WEEK" &&
        !isWithinLastWeek(customer.created_at)
      ) {
        return false;
      }

      if (filters.segment === "REPEAT" && customer.reservation_count < 2) {
        return false;
      }

      return true;
    });
  }, [customers, filters.q, filters.segment]);

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
      sortable: true,
      sortAccessor: (customer) =>
        `${customer.last_name} ${customer.first_name}`,
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
      sortable: true,
      sortAccessor: (customer) => customer.reservation_count,
      defaultSortDirection: "desc",
    },
    {
      id: "last_booking",
      header: "Last booking",
      mobileLabel: "Last booking",
      cell: (customer) =>
        customer.last_reservation_at
          ? formatDate(customer.last_reservation_at)
          : "—",
      sortable: true,
      sortAccessor: (customer) =>
        customer.last_reservation_at
          ? new Date(customer.last_reservation_at)
          : null,
      defaultSortDirection: "desc",
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
      sortable: true,
      sortAccessor: (customer) => new Date(customer.created_at),
      defaultSortDirection: "desc",
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
        <StatTile label="Total customers" value={statistics.total} />
        <StatTile label="New this week" value={statistics.newThisWeek} />
        <StatTile label="Repeat customers" value={statistics.repeatCustomers} />
        <StatTile
          label="Total reservations"
          value={statistics.totalReservations}
        />
        <StatTile
          label="Avg. reservations"
          value={statistics.avgReservations.toFixed(1)}
        />
      </StatTileGrid>

      <Toolbar
        footer={
          <>
            <p>
              Showing{" "}
              <span className="font-medium text-ink">
                {filteredCustomers.length}
              </span>{" "}
              of{" "}
              <span className="font-medium text-ink">{customers.length}</span>{" "}
              customers
            </p>

            {isFiltered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </>
        }
      >
        <Field label="Search" className="sm:col-span-2 lg:col-span-3">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="search"
              value={filters.q}
              onChange={(event) => setFilters({ q: event.target.value })}
              placeholder="Name, address or postal code..."
            />
          )}
        </Field>

        <Field label="Segment">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={filters.segment}
              onChange={(event) => setFilters({ segment: event.target.value })}
            >
              <option value="ALL">All customers</option>
              <option value="NEW_THIS_WEEK">New this week</option>
              <option value="REPEAT">Repeat customers</option>
            </Select>
          )}
        </Field>
      </Toolbar>

      <DataTable
        rows={filteredCustomers}
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
    </PageShell>
  );
}
