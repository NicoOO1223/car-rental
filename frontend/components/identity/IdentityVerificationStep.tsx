"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";

import {
  createIdentityVerificationSession,
  refreshIdentityVerificationStatus,
  type IdentityVerification,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

const STATUS_LABEL: Record<string, string> = {
  requires_input: "Verification not yet completed.",
  processing: "Verification submitted — waiting on Stripe's review.",
  verified: "Identity verified.",
  canceled: "Verification was canceled.",
};

type Props = {
  customerId: string;
  identityVerification: IdentityVerification | null;
  onUpdate: (identityVerification: IdentityVerification | null) => void;
};

// Shared by the (optional) booking-wizard confirmation screen and the
// staff handover screen — launches Stripe Identity's hosted document +
// selfie capture. This app never collects the document itself; it only
// stores the resulting status, document type, and issuing country (see
// backend/app/services/identity_verification.py).
export function IdentityVerificationStep({
  customerId,
  identityVerification,
  onUpdate,
}: Props) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const status = identityVerification?.status ?? null;

  async function handleVerify() {
    if (!stripePromise) return;

    setWorking(true);
    setError("");

    try {
      const stripe = await stripePromise;
      const { client_secret } = await createIdentityVerificationSession(customerId);

      if (!stripe || !client_secret) {
        throw new Error("Failed to start identity verification.");
      }

      const { error: stripeError } = await stripe.verifyIdentity(client_secret);

      if (stripeError) {
        throw new Error(stripeError.message || "Identity verification failed.");
      }

      const updated = await refreshIdentityVerificationStatus(customerId);
      onUpdate(updated.identity_verification);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify identity.");
    } finally {
      setWorking(false);
    }
  }

  async function handleCheckStatus() {
    setWorking(true);
    setError("");

    try {
      const updated = await refreshIdentityVerificationStatus(customerId);
      onUpdate(updated.identity_verification);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check status.");
    } finally {
      setWorking(false);
    }
  }

  if (!stripePromise) {
    return (
      <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700">
        Stripe is not configured yet — set{" "}
        <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> in{" "}
        <code>frontend/.env.local</code> to enable identity verification.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        {status ? (STATUS_LABEL[status] ?? status) : "Not started."}
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {status !== "verified" && (
        <div className="flex gap-3">
          <Button onClick={handleVerify} disabled={working}>
            {working ? "Working..." : status ? "Retry verification" : "Verify identity"}
          </Button>

          {(status === "processing" || status === "requires_input") && (
            <Button variant="secondary" onClick={handleCheckStatus} disabled={working}>
              Check status
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
