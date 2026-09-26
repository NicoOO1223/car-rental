"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import {
  saveIdentityDetails,
  type IdentityDetails,
} from "@/lib/api";
import { getCountries } from "@/lib/countries";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

const DOCUMENT_TYPES = [
  { value: "ID_CARD", get label() { return t("c.identity.IdentityDetailsForm.idCard"); } },
  { value: "PASSPORT", get label() { return t("c.identity.IdentityDetailsForm.passport"); } },
  { value: "RESIDENCE_PERMIT", get label() { return t("c.identity.IdentityDetailsForm.residencePermit"); } },
];

type Props = {
  customerId: string;
  reservationId: string;
  // The customer's nationality. For "PL" the national number is a PESEL and
  // is checked as one when entered; no other country has a special rule.
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
      setError(err instanceof Error ? err.message : t("c.identity.IdentityDetailsForm.failedSaveDetails"));
    } finally {
      setSaving(false);
    }
  }

  if (details.legacy_stripe_verified && !editing) {
    return (
      <p className="text-sm text-gray-700">{t("c.identity.IdentityDetailsForm.identityVerifiedThroughStripe")}</p>
    );
  }

  if (complete && !editing) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-700">{t(
          details.identity_checked_by_email
            ? details.identity_checked_at
              ? "c.identity.IdentityDetailsForm.recordedByOn"
              : "c.identity.IdentityDetailsForm.recordedBy"
            : details.identity_checked_at
              ? "c.identity.IdentityDetailsForm.recordedOn"
              : "c.identity.IdentityDetailsForm.recorded",
          {
            email: details.identity_checked_by_email ?? "",
            date: details.identity_checked_at ? formatDateTime(details.identity_checked_at) : "",
          },
        )}</p>

        <Button variant="secondary" onClick={() => setEditing(true)}>{t("c.identity.IdentityDetailsForm.editDetails")}</Button>
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
        <h3 className="text-sm font-semibold text-ink">{t("c.identity.IdentityDetailsForm.identityDocument")}</h3>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <TextField
            label={nationality === "PL" ? t("c.identity.IdentityDetailsForm.pesel") : t("c.identity.IdentityDetailsForm.nationalIdNumber")}
            hint={t("c.identity.IdentityDetailsForm.ifCustomerHasOne")}
            className="sm:col-span-2"
            value={nationalId}
            onChange={(event) => setNationalId(event.target.value)}
          />

          <SelectField
            label={t("c.identity.IdentityDetailsForm.documentType")}
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
          >
            <option value="">{t("c.identity.IdentityDetailsForm.notRecorded")}</option>
            {DOCUMENT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>

          <TextField
            label={t("c.identity.IdentityDetailsForm.documentNumber")}
            value={documentNumber}
            onChange={(event) => setDocumentNumber(event.target.value)}
          />

          <TextField
            label={t("c.identity.IdentityDetailsForm.documentExpiry")}
            type="date"
            value={documentExpiry}
            onChange={(event) => setDocumentExpiry(event.target.value)}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">{t("c.identity.IdentityDetailsForm.drivingLicence")}</h3>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("c.identity.IdentityDetailsForm.licenceNumber")}
            required
            value={licenseNumber}
            onChange={(event) => setLicenseNumber(event.target.value)}
          />

          <SelectField
            label={t("c.identity.IdentityDetailsForm.issuingCountry")}
            value={licenseCountry}
            onChange={(event) => setLicenseCountry(event.target.value)}
          >
            <option value="">{t("c.identity.IdentityDetailsForm.selectCountry")}</option>
            {getCountries().map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </SelectField>

          <TextField
            label={t("c.identity.IdentityDetailsForm.categories")}
            hint={t("c.identity.IdentityDetailsForm.eGBBe")}
            value={licenseCategories}
            onChange={(event) => setLicenseCategories(event.target.value)}
          />

          <TextField
            label={t("c.identity.IdentityDetailsForm.issueDate")}
            type="date"
            value={licenseIssued}
            onChange={(event) => setLicenseIssued(event.target.value)}
          />

          <TextField
            label={t("c.identity.IdentityDetailsForm.expiryDate")}
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
        />{t("c.identity.IdentityDetailsForm.iHaveCheckedCustomer")}</label>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={saving || !documentsChecked}>
          {saving ? t("c.identity.IdentityDetailsForm.saving") : t("c.identity.IdentityDetailsForm.saveIdentityDetails")}
        </Button>

        {editing && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEditing(false)}
          >{t("c.identity.IdentityDetailsForm.cancel")}</Button>
        )}
      </div>
    </form>
  );
}
