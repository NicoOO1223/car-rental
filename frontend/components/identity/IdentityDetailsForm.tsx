"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import {
  saveIdentityDetails,
  type IdentityDetails,
} from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { formatDateTime } from "@/lib/format";

const DOCUMENT_TYPES = [
  { value: "ID_CARD", label: "ID card" },
  { value: "PASSPORT", label: "Passport" },
  { value: "RESIDENCE_PERMIT", label: "Residence permit" },
];

type Props = {
  customerId: string;
  reservationId: string;
  // The customer's nationality; "PL" means the ID number is a PESEL.
  nationality: string | null;
  details: IdentityDetails;
  onSaved: (details: IdentityDetails) => void;
};

/**
 * Staff type in the customer's ID and driving licence details from the
 * original documents, then confirm they checked them. Replaces the old
 * Stripe Identity check.
 */
export function IdentityDetailsForm({
  customerId,
  reservationId,
  nationality,
  details,
  onSaved,
}: Props) {
  const [nationalId, setNationalId] = useState(details.national_id_number ?? "");
  const [documentType, setDocumentType] = useState(details.id_document_type ?? "");
  const [documentNumber, setDocumentNumber] = useState(
    details.id_document_number ?? "",
  );
  const [documentExpiry, setDocumentExpiry] = useState(
    details.id_document_expires_at ?? "",
  );
  const [licenseNumber, setLicenseNumber] = useState(
    details.driving_license_number ?? "",
  );
  const [licenseCountry, setLicenseCountry] = useState(
    details.driving_license_country ?? "",
  );
  const [licenseCategories, setLicenseCategories] = useState(
    details.driving_license_categories ?? "",
  );
  const [licenseIssued, setLicenseIssued] = useState(
    details.driving_license_issued_at ?? "",
  );
  const [licenseExpiry, setLicenseExpiry] = useState(
    details.driving_license_expires_at ?? "",
  );
  const [documentsChecked, setDocumentsChecked] = useState(false);

  // Once complete the form collapses to a summary; "Edit" reopens it.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const complete = details.problem === null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const saved = await saveIdentityDetails(
        customerId,
        {
          national_id_number: nationalId,
          id_document_type: documentType || null,
          id_document_number: documentNumber || null,
          id_document_expires_at: documentExpiry || null,
          driving_license_number: licenseNumber,
          driving_license_country: licenseCountry || null,
          driving_license_categories: licenseCategories || null,
          driving_license_issued_at: licenseIssued || null,
          driving_license_expires_at: licenseExpiry,
          documents_checked: documentsChecked,
        },
        reservationId,
      );

      onSaved(saved);
      setEditing(false);
      setDocumentsChecked(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save details.");
    } finally {
      setSaving(false);
    }
  }

  if (details.legacy_stripe_verified && !editing) {
    return (
      <p className="text-sm text-gray-700">
        Identity verified through Stripe Identity.
      </p>
    );
  }

  if (complete && !editing) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-700">
          Identity and driving licence recorded
          {details.identity_checked_by_email &&
            ` — documents checked by ${details.identity_checked_by_email}`}
          {details.identity_checked_at &&
            ` on ${formatDateTime(details.identity_checked_at)}`}
          .
        </p>

        <Button variant="secondary" onClick={() => setEditing(true)}>
          Edit details
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {details.problem && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {details.problem}
        </p>
      )}

      <div>
        <h3 className="text-sm font-semibold text-ink">Identity document</h3>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <TextField
            label={nationality === "PL" ? "PESEL" : "National ID number"}
            required
            className="sm:col-span-2"
            value={nationalId}
            onChange={(event) => setNationalId(event.target.value)}
          />

          <SelectField
            label="Document type"
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
          >
            <option value="">Not recorded</option>
            {DOCUMENT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Document number"
            value={documentNumber}
            onChange={(event) => setDocumentNumber(event.target.value)}
          />

          <TextField
            label="Document expiry"
            type="date"
            value={documentExpiry}
            onChange={(event) => setDocumentExpiry(event.target.value)}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">Driving licence</h3>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <TextField
            label="Licence number"
            required
            value={licenseNumber}
            onChange={(event) => setLicenseNumber(event.target.value)}
          />

          <SelectField
            label="Issuing country"
            value={licenseCountry}
            onChange={(event) => setLicenseCountry(event.target.value)}
          >
            <option value="">Select a country...</option>
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Categories"
            hint="e.g. B, BE"
            value={licenseCategories}
            onChange={(event) => setLicenseCategories(event.target.value)}
          />

          <TextField
            label="Issue date"
            type="date"
            value={licenseIssued}
            onChange={(event) => setLicenseIssued(event.target.value)}
          />

          <TextField
            label="Expiry date"
            type="date"
            required
            className="sm:col-span-2"
            value={licenseExpiry}
            onChange={(event) => setLicenseExpiry(event.target.value)}
          />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={documentsChecked}
          onChange={(event) => setDocumentsChecked(event.target.checked)}
        />
        I have checked the customer&apos;s original documents and the details
        above match them.
      </label>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={saving || !documentsChecked}>
          {saving ? "Saving..." : "Save identity details"}
        </Button>

        {editing && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
