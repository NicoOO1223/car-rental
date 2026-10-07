"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { updateCustomer, type Customer } from "@/lib/api";
import { getCountries } from "@/lib/countries";
import { t } from "@/lib/i18n";

type Props = {
  customer: Customer;
  onClose: () => void;
  onSaved: (updated: Customer) => void;
};

export function CustomerEditModal({ customer, onClose, onSaved }: Props) {
  const [firstName, setFirstName] = useState(customer.first_name);
  const [lastName, setLastName] = useState(customer.last_name);
  const [dateOfBirth, setDateOfBirth] = useState(customer.date_of_birth);
  const [address, setAddress] = useState(customer.address);
  const [postalCode, setPostalCode] = useState(customer.postal_code);
  const [phoneNumber, setPhoneNumber] = useState(customer.phone_number ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [nationality, setNationality] = useState(customer.nationality ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const updated = await updateCustomer(customer.id, {
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dateOfBirth,
        address,
        postal_code: postalCode,
        phone_number: phoneNumber,
        email,
        nationality: nationality || undefined,
      });

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("c.customers.CustomerEditModal.failedUpdateCustomer"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title={t("c.customers.CustomerEditModal.editCustomer")}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t("c.customers.CustomerEditModal.cancel")}</Button>
          <Button type="submit" form="customer-edit-form" loading={saving}>
            {saving ? t("c.customers.CustomerEditModal.saving") : t("c.customers.CustomerEditModal.saveChanges")}
          </Button>
        </>
      }
    >
      <form
        id="customer-edit-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("c.customers.CustomerEditModal.firstName")}
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />

          <TextField
            label={t("c.customers.CustomerEditModal.lastName")}
            required
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />

          <TextField
            label={t("c.customers.CustomerEditModal.dateBirth")}
            type="date"
            required
            autoComplete="bday"
            value={dateOfBirth}
            onChange={(event) => setDateOfBirth(event.target.value)}
          />

          <TextField
            label={t("c.customers.CustomerEditModal.postalCode")}
            required
            autoComplete="postal-code"
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value)}
          />

          <TextField
            label={t("c.customers.CustomerEditModal.phoneNumber")}
            type="tel"
            required
            autoComplete="tel"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
          />

          <TextField
            label={t("c.customers.CustomerEditModal.email")}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <TextField
            label={t("c.customers.CustomerEditModal.address")}
            required
            autoComplete="street-address"
            className="sm:col-span-2"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />

          <SelectField
            label={t("c.customers.CustomerEditModal.nationality")}
            autoComplete="country"
            value={nationality}
            onChange={(event) => setNationality(event.target.value)}
          >
            <option value="">{t("c.customers.CustomerEditModal.selectCountry")}</option>
            {getCountries().map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </SelectField>
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
