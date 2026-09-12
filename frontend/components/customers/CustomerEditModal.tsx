"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { updateCustomer, type Customer } from "@/lib/api";

type Props = {
  customer: Customer;
  onClose: () => void;
  onSaved: (updated: Customer) => void;
};

const inputClass = "mt-2 w-full rounded-lg border p-3";
const labelClass = "block text-sm font-medium";

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
      title="Edit Customer"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="customer-edit-form" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
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
          <div>
            <label className={labelClass}>First Name</label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Last Name</label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Date of Birth</label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Postal Code</label>
            <input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Phone Number</label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputClass}
              required
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
