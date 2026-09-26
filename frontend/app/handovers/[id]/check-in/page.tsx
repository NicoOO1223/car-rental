"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Banknote, Check, CreditCard } from "lucide-react";

import {
  createPaymentIntent,
  generateAgreement,
  downloadAgreement,
  getHandover,
  getIdentityDetails,
  getPublicConfiguration,
  getReservation,
  submitEmployeeSignature,
  submitSignature,
  type Handover,
  type IdentityDetails,
  type PaymentIntent,
  type Reservation,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { CashPaymentForm, PaymentStep } from "@/components/handover/PaymentStep";
import { DepositStep } from "@/components/handover/DepositStep";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/handover/SignaturePad";
import { IdentityDetailsForm } from "@/components/identity/IdentityDetailsForm";
import { StepHeader, type StepStatus } from "@/components/handover/StepHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";

type Props = {
  params: Promise<{ id: string }>;
};

export default function FinalizeHandoverPage({ params }: Props) {
  const navigate = useNavigate();
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(
    null,
  );

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [paymentIntentError, setPaymentIntentError] = useState("");

  const [signing, setSigning] = useState(false);
  const [signatureError, setSignatureError] = useState("");

  const [employeeSigning, setEmployeeSigning] = useState(false);
  const [employeeSignatureError, setEmployeeSignatureError] = useState("");

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  const [identityDetails, setIdentityDetails] =
    useState<IdentityDetails | null>(null);
  // 0 = deposits are off.
  const [depositAmount, setDepositAmount] = useState(0);

  const signaturePadRef = useRef<SignaturePadHandle>(null);
  const employeeSignaturePadRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    async function load() {
      try {
        const { id } = await params;
        setReservationId(id);

        const [reservationData, handoverData] = await Promise.all([
          getReservation(id),
          getHandover(id),
        ]);

        setReservation(reservationData);
        setHandover(handoverData);
        setIdentityDetails(
          await getIdentityDetails(reservationData.customer.id, id),
        );
        setDepositAmount(
          (await getPublicConfiguration()).security_deposit_amount,
        );

        if (handoverData.payment_status !== "SUCCEEDED") {
          // A payment-intent failure (e.g. Stripe not configured yet)
          // shouldn't take down the whole page — show it inline on the
          // payment step instead.
          try {
            const intent = await createPaymentIntent(id);
            setPaymentIntent(intent);
          } catch (paymentError) {
            setPaymentIntentError(
              paymentError instanceof Error
                ? paymentError.message
                : "Failed to start payment.",
            );
          }
        }
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load handover.",
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [params]);

  async function handlePaid() {
    if (!reservationId) return;

    const updated = await getHandover(reservationId);
    setHandover(updated);
  }

  async function handleSaveSignature() {
    if (!reservationId || !signaturePadRef.current) return;

    if (signaturePadRef.current.isEmpty()) {
      setSignatureError("Please have the customer sign before continuing.");
      return;
    }

    setSigning(true);
    setSignatureError("");

    try {
      const dataUrl = signaturePadRef.current.toDataURL();
      const updated = await submitSignature(reservationId, dataUrl);
      setHandover(updated);
    } catch (error) {
      setSignatureError(
        error instanceof Error ? error.message : "Failed to save signature.",
      );
    } finally {
      setSigning(false);
    }
  }

  async function handleSaveEmployeeSignature() {
    if (!reservationId || !employeeSignaturePadRef.current) return;

    if (employeeSignaturePadRef.current.isEmpty()) {
      setEmployeeSignatureError("Please sign before continuing.");
      return;
    }

    setEmployeeSigning(true);
    setEmployeeSignatureError("");

    try {
      const dataUrl = employeeSignaturePadRef.current.toDataURL();
      const updated = await submitEmployeeSignature(reservationId, dataUrl);
      setHandover(updated);
    } catch (error) {
      setEmployeeSignatureError(
        error instanceof Error
          ? error.message
          : "Failed to save employee signature.",
      );
    } finally {
      setEmployeeSigning(false);
    }
  }

  async function handleGenerateAgreement() {
    if (!reservationId) return;

    setGenerating(true);
    setGenerateError("");

    try {
      const updated = await generateAgreement(reservationId);
      setHandover(updated);

      const refreshedReservation = await getReservation(reservationId);
      setReservation(refreshedReservation);
    } catch (error) {
      setGenerateError(
        error instanceof Error
          ? error.message
          : "Failed to generate agreement.",
      );
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          <Skeleton className="mb-4 h-4 w-32" />
          <Skeleton className="mb-8 h-9 w-56" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </main>
    );
  }

  if (loadError || !reservation || !handover) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          <button
            onClick={() => navigate("/handovers")}
            className="mb-6 flex items-center gap-1 text-sm text-gray-500 hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to handovers
          </button>

          <p className="text-red-600">
            {loadError || "Reservation not found."}
          </p>
        </div>
      </main>
    );
  }

  const paymentDone = handover.payment_status === "SUCCEEDED";
  const signatureDone = handover.has_signature;
  const employeeSignatureDone = handover.has_employee_signature;
  const identityDone = identityDetails?.problem === null;
  const agreementDone = handover.has_agreement;

  // A deposit is required when one is configured, or was already taken.
  const depositRequired = handover.deposit_status !== null || depositAmount > 0;
  const depositDone = handover.deposit_status === "HELD";
  const depositOk = !depositRequired || depositDone;

  // Step numbers shift by one when the deposit step is shown.
  const identityIndex = depositRequired ? 3 : 2;

  const paymentStatus: StepStatus = paymentDone ? "done" : "active";
  const depositStatus: StepStatus = agreementDone
    ? "done"
    : depositDone
      ? "done"
      : paymentDone
        ? "active"
        : "locked";
  const identityStatus: StepStatus = agreementDone
    ? "done"
    : identityDone
      ? "done"
      : paymentDone && depositOk
        ? "active"
        : "locked";
  const signatureStatus: StepStatus = agreementDone
    ? "done"
    : signatureDone
      ? "done"
      : identityDone
        ? "active"
        : "locked";
  const employeeSignatureStatus: StepStatus = agreementDone
    ? "done"
    : employeeSignatureDone
      ? "done"
      : signatureDone && identityDone
        ? "active"
        : "locked";
  const agreementStatus: StepStatus = agreementDone
    ? "done"
    : signatureDone && identityDone && employeeSignatureDone && depositOk
      ? "active"
      : "locked";

  return (
    <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <button
            onClick={() => navigate("/handovers")}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to handovers
          </button>

          <button
            onClick={() => navigate(`/reservations/manage/${reservation.id}`)}
            className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-black"
          >
            View/Change Reservation
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Vehicle Check-in</h1>
            <p className="mt-2 text-gray-600">
              {reservation.customer.first_name}{" "}
              {reservation.customer.last_name} · {reservation.car.make}{" "}
              {reservation.car.model} · {reservation.car.license_plate}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Booked {formatDateTime(reservation.created_at)}
            </p>
          </div>

          <ReservationStatusBadge status={reservation.status} />
        </div>

        {agreementDone ? (
          <Card className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-900 text-white">
              <Check className="h-6 w-6" />
            </div>

            <h2 className="text-xl font-semibold">Check-in complete</h2>

            <p className="mt-2 text-sm text-gray-600">
              The rental agreement has been generated and the reservation is
              now active.
            </p>

            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() =>
                  downloadAgreement(
                    reservation.id,
                    `agreement-${reservation.id}.pdf`,
                  )
                }
                className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
              >
                Download Agreement
              </button>

              <Button
                variant="secondary"
                onClick={() =>
                  navigate(`/reservations/manage/${reservation.id}`)
                }
              >
                View Reservation
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Step 1: Payment */}
            <Card>
              <StepHeader index={1} title="Payment" status={paymentStatus} />

              <div className="mt-5">
                {paymentDone ? (
                  <p className="flex items-center gap-1.5 text-sm text-gray-700">
                    {handover.payment_method === "CASH" ? (
                      <Banknote className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    Payment received
                    {handover.payment_method &&
                      ` (${handover.payment_method === "CASH" ? "Cash" : "Card"})`}
                    {handover.payment_amount !== null &&
                      ` — ${handover.payment_amount.toFixed(2)} ${handover.payment_currency?.toUpperCase()}`}
                    .
                  </p>
                ) : paymentIntentError ? (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700">
                      {paymentIntentError} Card payment is unavailable, but you
                      can still take cash.
                    </div>
                    <CashPaymentForm
                      reservationId={reservation.id}
                      onPaid={handlePaid}
                    />
                  </div>
                ) : paymentIntent?.client_secret ? (
                  <PaymentStep
                    reservationId={reservation.id}
                    clientSecret={paymentIntent.client_secret}
                    amount={paymentIntent.payment_amount}
                    currency={paymentIntent.payment_currency}
                    baseAmount={paymentIntent.base_amount}
                    shortTermFee={paymentIntent.short_term_fee}
                    airportChangeFee={paymentIntent.airport_change_fee}
                    extras={paymentIntent.extras}
                    extrasAmount={paymentIntent.extras_amount}
                    vat={{
                      rate: paymentIntent.vat_rate,
                      amount: paymentIntent.vat_amount,
                      net: paymentIntent.net_amount,
                      includedInPrices: paymentIntent.prices_include_vat,
                    }}
                    onPaid={handlePaid}
                  />
                ) : (
                  <p className="text-sm text-gray-500">
                    Preparing payment...
                  </p>
                )}
              </div>
            </Card>

            {/* Step 2: Security deposit (only when deposits are on) */}
            {depositRequired && (
              <Card className={depositStatus === "locked" ? "opacity-50" : ""}>
                <StepHeader index={2} title="Security Deposit" status={depositStatus} />

                <div className="mt-5">
                  {depositDone ? (
                    <p className="text-sm text-gray-700">
                      Deposit held (
                      {handover.deposit_method === "CASH" ? "Cash" : "Card hold"}) —{" "}
                      {handover.deposit_amount !== null &&
                        `${handover.deposit_amount.toFixed(2)} ${handover.deposit_currency?.toUpperCase() ?? ""}`}
                      .
                    </p>
                  ) : depositStatus === "active" ? (
                    <DepositStep
                      reservationId={reservation.id}
                      amount={handover.deposit_amount ?? depositAmount}
                      currency={handover.deposit_currency}
                      onHeld={handlePaid}
                    />
                  ) : (
                    <p className="text-sm text-ink-muted">Complete payment first.</p>
                  )}
                </div>
              </Card>
            )}

            {/* Identity verification */}
            <Card className={identityStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader
                index={identityIndex}
                title="Identity & Driving Licence"
                status={identityStatus}
              />

              <div className="mt-5">
                {(identityStatus === "active" || identityStatus === "done") &&
                identityDetails ? (
                  <IdentityDetailsForm
                    customerId={reservation.customer.id}
                    reservationId={reservation.id}
                    nationality={reservation.customer.nationality}
                    details={identityDetails}
                    onSaved={setIdentityDetails}
                  />
                ) : (
                  <p className="text-sm text-ink-muted">
                    Complete payment{depositRequired ? " and the deposit" : ""} first.
                  </p>
                )}
              </div>
            </Card>

            {/* Step 3: Signature */}
            <Card className={signatureStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader
                index={identityIndex + 1}
                title="Customer Signature"
                status={signatureStatus}
              />

              <div className="mt-5">
                {signatureDone ? (
                  <p className="text-sm text-gray-700">
                    Signature captured.
                  </p>
                ) : signatureStatus === "active" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      Have the customer sign below.
                    </p>

                    <SignaturePad ref={signaturePadRef} />

                    {signatureError && (
                      <p className="text-sm text-red-600">{signatureError}</p>
                    )}

                    <div className="flex gap-3">
                      <Button
                        variant="secondary"
                        onClick={() => signaturePadRef.current?.clear()}
                      >
                        Clear
                      </Button>

                      <Button onClick={handleSaveSignature} disabled={signing}>
                        {signing ? "Saving..." : "Save Signature"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">
                    Verify the customer&apos;s identity first.
                  </p>
                )}
              </div>
            </Card>

            {/* Step 4: Employee signature */}
            <Card
              className={employeeSignatureStatus === "locked" ? "opacity-50" : ""}
            >
              <StepHeader
                index={identityIndex + 2}
                title="Employee Signature"
                status={employeeSignatureStatus}
              />

              <div className="mt-5">
                {employeeSignatureDone ? (
                  <p className="text-sm text-gray-700">
                    Signed by {handover.employee_signed_by_email ?? "an employee"}
                    {handover.employee_signed_at &&
                      ` on ${formatDateTime(handover.employee_signed_at)}`}
                    .
                  </p>
                ) : employeeSignatureStatus === "active" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      The approving employee signs below to confirm the
                      handover.
                    </p>

                    <SignaturePad ref={employeeSignaturePadRef} />

                    {employeeSignatureError && (
                      <p className="text-sm text-red-600">
                        {employeeSignatureError}
                      </p>
                    )}

                    <div className="flex gap-3">
                      <Button
                        variant="secondary"
                        onClick={() => employeeSignaturePadRef.current?.clear()}
                      >
                        Clear
                      </Button>

                      <Button
                        onClick={handleSaveEmployeeSignature}
                        disabled={employeeSigning}
                      >
                        {employeeSigning ? "Saving..." : "Save Signature"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">
                    Capture the customer&apos;s signature and verify their
                    identity first.
                  </p>
                )}
              </div>
            </Card>

            {/* Step 5: Generate agreement */}
            <Card className={agreementStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader
                index={identityIndex + 3}
                title="Generate Agreement"
                status={agreementStatus}
              />

              <div className="mt-5">
                {agreementStatus === "active" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      This will generate the rental agreement, mark the
                      reservation as active, and assign the vehicle to the
                      customer.
                    </p>

                    {generateError && (
                      <p className="text-sm text-red-600">{generateError}</p>
                    )}

                    <Button onClick={handleGenerateAgreement} disabled={generating} fullWidth>
                      {generating
                        ? "Generating..."
                        : "Generate Agreement & Start Rental"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">
                    Complete the customer and employee signatures and verify
                    the customer&apos;s identity first.
                  </p>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
