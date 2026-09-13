"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { updateCustomer, type Customer } from "@/lib/api";

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
      });

      onSaved(updated);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update customer.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      title="Edit customer"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="customer-edit-form" loading={saving}>
            {saving ? "Saving" : "Save changes"}
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
            label="First name"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />

          <TextField
            label="Last name"
            required
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />

          <TextField
            label="Date of birth"
            type="date"
            required
            autoComplete="bday"
            value={dateOfBirth}
            onChange={(event) => setDateOfBirth(event.target.value)}
          />

          <TextField
            label="Postal code"
            required
            autoComplete="postal-code"
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value)}
          />

          <TextField
            label="Phone number"
            type="tel"
            required
            autoComplete="tel"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
          />

          <TextField
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <TextField
            label="Address"
            required
            autoComplete="street-address"
            className="sm:col-span-2"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
