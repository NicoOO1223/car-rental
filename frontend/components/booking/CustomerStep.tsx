"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, UserRound, X } from "lucide-react";

import { Field, Input, TextField } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { getCustomers, type CustomerListItem } from "@/lib/api";
import { formatDate } from "@/lib/format";

export type CustomerDetails = {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  address: string;
  postal_code: string;
  phone_number: string;
  email: string;
};

export const EMPTY_CUSTOMER: CustomerDetails = {
  first_name: "",
  last_name: "",
  date_of_birth: "",
  address: "",
  postal_code: "",
  phone_number: "",
  email: "",
};

/**
 * Customer details, with an existing customer selectable first.
 *
 * The old flow always made staff retype everything and relied on the
 * backend's find_matching_customer to deduplicate after the fact, which
 * only worked when the retyped details matched exactly. Picking a known
 * customer here fills the same fields from their record, so the dedupe
 * succeeds by construction and a repeat booking takes one click.
 */
export function CustomerStep({
  value,
  onChange,
  errors,
}: {
  value: CustomerDetails;
  onChange: (next: CustomerDetails) => void;
  errors: Partial<Record<keyof CustomerDetails, string>>;
}) {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getCustomers();
        if (!cancelled) setCustomers(data);
      } catch {
        // A failure here only costs the shortcut — the form below still
        // works, so this is not surfaced as a blocking error.
        if (!cancelled) setLoadFailed(true);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2) return [];

    return customers
      .filter((customer) =>
        `${customer.first_name} ${customer.last_name} ${customer.email ?? ""} ${customer.phone_number ?? ""}`
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 6);
  }, [customers, query]);

  function selectCustomer(customer: CustomerListItem) {
    setSelectedId(customer.id);
    setQuery("");
    onChange({
      first_name: customer.first_name,
      last_name: customer.last_name,
      date_of_birth: customer.date_of_birth,
      address: customer.address,
      postal_code: customer.postal_code,
      phone_number: customer.phone_number ?? "",
      email: customer.email ?? "",
    });
  }

  function clearSelection() {
    setSelectedId(null);
    onChange(EMPTY_CUSTOMER);
  }

  const set = (key: keyof CustomerDetails) => (event: { target: { value: string } }) =>
    onChange({ ...value, [key]: event.target.value });

  const selected = customers.find((customer) => customer.id === selectedId);

  return (
    <div className="space-y-6">
      {!loadFailed && (
        <div className="rounded-xl bg-surface p-5 shadow-sm">
          {selected ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {selected.first_name} {selected.last_name}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    Existing customer · {selected.reservation_count} previous
                    booking{selected.reservation_count === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="h-4 w-4" aria-hidden="true" />
                Clear
              </Button>
            </div>
          ) : (
            <Field
              label="Returning customer"
              hint="Search by name, email or phone to fill the form automatically."
            >
              {(fieldProps) => (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                    aria-hidden="true"
                  />
                  <Input
                    {...fieldProps}
                    type="search"
                    autoComplete="off"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Start typing a name..."
                    className="pl-9"
                  />

                  {matches.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-lg">
                      {matches.map((customer) => (
                        <li key={customer.id}>
                          <button
                            type="button"
                            onClick={() => selectCustomer(customer)}
                            className="block w-full px-4 py-2.5 text-left transition hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
                          >
                            <p className="text-sm font-medium text-ink">
                              {customer.first_name} {customer.last_name}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-muted">
                              Born {formatDate(customer.date_of_birth)}
                              {customer.email ? ` · ${customer.email}` : ""}
                            </p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Field>
          )}
        </div>
      )}

      <div className="rounded-xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink">
          {selected ? "Confirm details" : "Customer details"}
        </h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            required
            autoComplete="given-name"
            value={value.first_name}
            onChange={set("first_name")}
            error={errors.first_name}
          />

          <TextField
            label="Last name"
            required
            autoComplete="family-name"
            value={value.last_name}
            onChange={set("last_name")}
            error={errors.last_name}
          />

          <TextField
            label="Date of birth"
            type="date"
            required
            autoComplete="bday"
            value={value.date_of_birth}
            onChange={set("date_of_birth")}
            error={errors.date_of_birth}
          />

          <TextField
            label="Postal code"
            required
            autoComplete="postal-code"
            value={value.postal_code}
            onChange={set("postal_code")}
            error={errors.postal_code}
          />

          <TextField
            label="Address"
            required
            autoComplete="street-address"
            className="sm:col-span-2"
            value={value.address}
            onChange={set("address")}
            error={errors.address}
          />

          <TextField
            label="Phone number"
            type="tel"
            autoComplete="tel"
            value={value.phone_number}
            onChange={set("phone_number")}
            error={errors.phone_number}
          />

          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={value.email}
            onChange={set("email")}
            error={errors.email}
          />
        </div>
      </div>
    </div>
  );
}
