"use client";

import { useEffect, useState } from "react";
import { Search, UserRound, X } from "lucide-react";

import { Field, Input, SelectField, TextField } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { getCustomer, getCustomers, type CustomerListItem } from "@/lib/api";
import { getCountries } from "@/lib/countries";
import { formatDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { t } from "@/lib/i18n";

export type CustomerDetails = {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  address: string;
  postal_code: string;
  phone_number: string;
  email: string;
  nationality: string;
  /** The language emails to the customer are written in; empty = the business default. */
  email_language: string;
};

export const EMPTY_CUSTOMER: CustomerDetails = {
  first_name: "",
  last_name: "",
  date_of_birth: "",
  address: "",
  postal_code: "",
  phone_number: "",
  email: "",
  nationality: "",
  email_language: "",
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
  const [results, setResults] = useState<CustomerListItem[]>([]);
  const [query, setQuery] = useState("");
  // Kept as the record itself, not an id into a list: there is no full
  // customer list to look it up in any more.
  const [selected, setSelected] = useState<CustomerListItem | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const term = useDebouncedValue(query.trim());

  // Results for a term that has since been shortened or cleared are stale.
  const matches = term.length < 2 ? [] : results;

  // Search on the server, six suggestions at a time, instead of
  // downloading every customer's personal details up front.
  useEffect(() => {
    if (term.length < 2) return;

    let cancelled = false;

    async function search() {
      try {
        const page = await getCustomers({ q: term, limit: 6 });

        if (cancelled) return;
        setResults(page.items);
        setLoadFailed(false);
      } catch {
        // A failure here only costs the shortcut — the form below still
        // works, so this is not surfaced as a blocking error.
        if (!cancelled) setLoadFailed(true);
      }
    }

    search();

    return () => {
      cancelled = true;
    };
  }, [term]);

  async function selectCustomer(listed: CustomerListItem) {
    setSelected(listed);
    setResults([]);
    setQuery("");

    // The list may show this person's details masked. Booking for them needs the
    // real ones, which opening the customer returns (and records as a view).
    let customer: { date_of_birth: string | null; address: string | null; phone_number: string | null; email: string | null } = listed;

    try {
      customer = await getCustomer(listed.id);
    } catch {
      // Fall back to what the list gave; the form shows what is missing.
    }

    onChange({
      first_name: listed.first_name,
      last_name: listed.last_name,
      date_of_birth: customer.date_of_birth ?? "",
      address: customer.address ?? "",
      postal_code: listed.postal_code,
      phone_number: customer.phone_number ?? "",
      email: customer.email ?? "",
      nationality: listed.nationality ?? "",
      email_language: value.email_language,
    });
  }

  function clearSelection() {
    setSelected(null);
    onChange(EMPTY_CUSTOMER);
  }

  const set = (key: keyof CustomerDetails) => (event: { target: { value: string } }) =>
    onChange({ ...value, [key]: event.target.value });

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
                  <p className="truncate text-xs text-ink-muted">{t("c.booking.CustomerStep.previousBookings", { count: selected.reservation_count })}</p>
                </div>
              </div>

              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="h-4 w-4" aria-hidden="true" />{t("c.booking.CustomerStep.clear")}</Button>
            </div>
          ) : (
            <Field
              label={t("c.booking.CustomerStep.returningCustomer")}
              hint={t("c.booking.CustomerStep.searchByNameEmail")}
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
                    placeholder={t("c.booking.CustomerStep.startTypingName")}
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
                              {[
                                customer.date_of_birth ? t("c.booking.CustomerStep.born", { date: formatDate(customer.date_of_birth) }) : null,
                                customer.email,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
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
          {selected ? t("c.booking.CustomerStep.confirmDetails") : t("c.booking.CustomerStep.customerDetails")}
        </h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("c.booking.CustomerStep.firstName")}
            required
            autoComplete="given-name"
            value={value.first_name}
            onChange={set("first_name")}
            error={errors.first_name}
          />

          <TextField
            label={t("c.booking.CustomerStep.lastName")}
            required
            autoComplete="family-name"
            value={value.last_name}
            onChange={set("last_name")}
            error={errors.last_name}
          />

          <TextField
            label={t("c.booking.CustomerStep.dateBirth")}
            type="date"
            required
            autoComplete="bday"
            value={value.date_of_birth}
            onChange={set("date_of_birth")}
            error={errors.date_of_birth}
          />

          <TextField
            label={t("c.booking.CustomerStep.postalCode")}
            required
            autoComplete="postal-code"
            value={value.postal_code}
            onChange={set("postal_code")}
            error={errors.postal_code}
          />

          <TextField
            label={t("c.booking.CustomerStep.address")}
            required
            autoComplete="street-address"
            className="sm:col-span-2"
            value={value.address}
            onChange={set("address")}
            error={errors.address}
          />

          <TextField
            label={t("c.booking.CustomerStep.phoneNumber")}
            type="tel"
            required
            autoComplete="tel"
            value={value.phone_number}
            onChange={set("phone_number")}
            error={errors.phone_number}
          />

          <TextField
            label={t("c.booking.CustomerStep.email")}
            type="email"
            required
            autoComplete="email"
            value={value.email}
            onChange={set("email")}
            error={errors.email}
          />

          <SelectField
            label={t("c.booking.CustomerStep.nationality")}
            autoComplete="country"
            value={value.nationality}
            onChange={set("nationality")}
            error={errors.nationality}
          >
            <option value="">{t("c.booking.CustomerStep.selectCountry")}</option>
            {getCountries().map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={t("c.booking.CustomerStep.emailLanguage")}
            hint={t("c.booking.CustomerStep.emailLanguageHint")}
            value={value.email_language}
            onChange={set("email_language")}
          >
            <option value="">{t("c.booking.CustomerStep.emailLanguageDefault")}</option>
            {["en", "it", "pl"].map((code) => (
              <option key={code} value={code}>
                {new Intl.DisplayNames([code], { type: "language" }).of(code)}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
    </div>
  );
}
