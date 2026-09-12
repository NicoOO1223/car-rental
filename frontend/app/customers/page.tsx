"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import {
  getCustomers,
  type CustomerListItem,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton, SkeletonRows, SkeletonStatTiles } from "@/components/ui/Skeleton";
import { useNavigate } from "@/lib/useNavigate";

export default function CustomersPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");

  async function refreshCustomers() {
    setRefreshing(true);
    setError("");

    try {
      const data = await getCustomers();
      setCustomers(data);
    } catch {
      setError("Failed to load customers.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    async function loadCustomers() {
      try {
        const data = await getCustomers();
        setCustomers(data);
      } catch {
        setError("Failed to load customers.");
      } finally {
        setLoading(false);
      }
    }

    loadCustomers();
  }, []);

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString();
  }

  function isWithinLastWeek(date: string) {
    const created = new Date(date);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    return created >= weekAgo;
  }

  /*
   * Summary statistics.
   */
  const statistics = useMemo(() => {
    const total = customers.length;
    const newThisWeek = customers.filter((customer) =>
      isWithinLastWeek(customer.created_at)
    ).length;
    const repeatCustomers = customers.filter(
      (customer) => customer.reservation_count >= 2
    ).length;
    const totalReservations = customers.reduce(
      (sum, customer) => sum + customer.reservation_count,
      0
    );
    const avgReservations =
      total === 0 ? 0 : totalReservations / total;

    return {
      total,
      newThisWeek,
      repeatCustomers,
      totalReservations,
      avgReservations,
    };
  }, [customers]);

  /*
   * Filter customers. The list is already sorted by the backend
   * (most recently booked first) — do not re-sort here.
   */
  const filteredCustomers = useMemo(() => {
    const searchValue = search.toLowerCase().trim();

    return customers.filter((customer) => {
      if (searchValue) {
        const name =
          `${customer.first_name} ${customer.last_name}`.toLowerCase();

        const matchesSearch =
          name.includes(searchValue) ||
          customer.address.toLowerCase().includes(searchValue) ||
          customer.postal_code.toLowerCase().includes(searchValue);

        if (!matchesSearch) {
          return false;
        }
      }

      if (
        filter === "NEW_THIS_WEEK" &&
        !isWithinLastWeek(customer.created_at)
      ) {
        return false;
      }

      if (filter === "REPEAT" && customer.reservation_count < 2) {
        return false;
      }

      return true;
    });
  }, [customers, search, filter]);

  const hasFilters = search !== "" || filter !== "ALL";

  function clearFilters() {
    setSearch("");
    setFilter("ALL");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <Skeleton className="mb-8 h-9 w-64" />
          <SkeletonStatTiles
            count={5}
            className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
          />
          <SkeletonRows count={6} />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <Card>
            <p className="text-red-600">{error}</p>

            <Button className="mt-4" onClick={() => refreshCustomers()}>
              Try again
            </Button>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Customers</h1>

            <p className="mt-2 text-gray-600">
              Everyone who has booked a vehicle, sorted by most recent booking.
            </p>
          </div>

          <Button
            variant="secondary"
            onClick={() => refreshCustomers()}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {/* Stat cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Total customers</p>
            <p className="mt-2 text-3xl font-bold">{statistics.total}</p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">New this week</p>
            <p className="mt-2 text-3xl font-bold">
              {statistics.newThisWeek}
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Repeat customers</p>
            <p className="mt-2 text-3xl font-bold">
              {statistics.repeatCustomers}
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Total reservations</p>
            <p className="mt-2 text-3xl font-bold">
              {statistics.totalReservations}
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Avg. reservations</p>
            <p className="mt-2 text-3xl font-bold">
              {statistics.avgReservations.toFixed(1)}
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-6 p-5">
          <div className="grid gap-4 lg:grid-cols-4">
            <div className="lg:col-span-3">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Search
              </label>

              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, address or postal code..."
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 outline-none transition focus:border-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Filter
              </label>

              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 outline-none focus:border-black"
              >
                <option value="ALL">All customers</option>
                <option value="NEW_THIS_WEEK">New this week</option>
                <option value="REPEAT">Repeat customers</option>
              </select>
            </div>
          </div>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="mt-4 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear filters
            </button>
          )}
        </Card>

        {/* Results */}
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing{" "}
            <span className="font-medium text-gray-700">
              {filteredCustomers.length}
            </span>{" "}
            of{" "}
            <span className="font-medium text-gray-700">
              {customers.length}
            </span>{" "}
            customers
          </p>

          <p className="hidden text-xs text-gray-400 sm:block">
            Sorted by most recent booking
          </p>
        </div>

        {/* Results list */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          {/* Mobile: card list */}
          <div className="divide-y lg:hidden">
            {filteredCustomers.map((customer) => (
              <button
                key={customer.id}
                onClick={() =>
                  navigate(`/customers/${customer.id}`)
                }
                className="block w-full p-4 text-left hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {customer.first_name} {customer.last_name}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {customer.postal_code}
                    </p>
                  </div>

                  <p className="shrink-0 text-sm font-medium text-gray-700">
                    {customer.reservation_count}{" "}
                    <span className="font-normal text-gray-400">
                      reservation{customer.reservation_count === 1 ? "" : "s"}
                    </span>
                  </p>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-gray-400">Last booking</p>
                    <p className="mt-0.5 font-medium text-gray-700">
                      {customer.last_reservation_at
                        ? formatDate(customer.last_reservation_at)
                        : "—"}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-400">Customer since</p>
                    <p className="mt-0.5 font-medium text-gray-700">
                      {formatDate(customer.created_at)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-sm font-semibold">
                    Customer
                  </th>
                  <th className="px-6 py-4 text-sm font-semibold">
                    Reservations
                  </th>
                  <th className="px-6 py-4 text-sm font-semibold">
                    Last booking
                  </th>
                  <th className="px-6 py-4 text-sm font-semibold">
                    Customer since
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredCustomers.map((customer) => (
                  <tr
                    key={customer.id}
                    onClick={() =>
                      navigate(`/customers/${customer.id}`)
                    }
                    className="cursor-pointer border-b last:border-b-0 hover:bg-gray-50"
                  >
                    <td className="px-6 py-5">
                      <div className="font-medium">
                        {customer.first_name} {customer.last_name}
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        {customer.postal_code}
                      </div>
                    </td>

                    <td className="px-6 py-5">{customer.reservation_count}</td>

                    <td className="px-6 py-5">
                      {customer.last_reservation_at
                        ? formatDate(customer.last_reservation_at)
                        : "—"}
                    </td>

                    <td className="px-6 py-5 text-sm text-gray-500">
                      {formatDate(customer.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Empty state */}
        {filteredCustomers.length === 0 && (
          <div className="mt-6 rounded-xl bg-white p-10 text-center shadow-sm">
            <p className="font-medium text-gray-700">No customers found</p>
            <p className="mt-1 text-sm text-gray-500">
              Try changing your search or filters.
            </p>

            {hasFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 text-sm font-medium underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
