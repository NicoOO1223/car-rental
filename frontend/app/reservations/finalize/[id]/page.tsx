"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";

import {
  createPaymentIntent,
  generateAgreement,
  downloadAgreement,
  getHandover,
  getReservation,
  submitSignature,
  type Handover,
  type PaymentIntent,
  type Reservation,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { PaymentStep } from "@/components/handover/PaymentStep";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/handover/SignaturePad";
import { Skeleton } from "@/components/ui/Skeleton";
import { useNavigate } from "@/lib/useNavigate";

type Props = {
  params: Promise<{ id: string }>;
};

type StepStatus = "locked" | "active" | "done";

function StepHeader({
  index,
  title,
  status,
}: {
  index: number;
  title: string;
  status: StepStatus;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          status === "done" || status === "active"
            ? "bg-black text-white"
            : "bg-gray-100 text-gray-400"
        }`}
      >
        {status === "done" ? <Check className="h-4 w-4" /> : index}
      </div>

      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

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

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  const signaturePadRef = useRef<SignaturePadHandle>(null);

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
      <main className="min-h-screen bg-gray-50 p-8">
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
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-3xl">
          <button
            onClick={() => navigate("/reservations/finalize")}
            className="mb-6 flex items-center gap-1 text-sm text-gray-500 hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to finalize
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
  const agreementDone = handover.has_agreement;

  const paymentStatus: StepStatus = paymentDone ? "done" : "active";
  const signatureStatus: StepStatus = agreementDone
    ? "done"
    : signatureDone
      ? "done"
      : paymentDone
        ? "active"
        : "locked";
  const agreementStatus: StepStatus = agreementDone
    ? "done"
    : signatureDone
      ? "active"
      : "locked";

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => navigate("/reservations/finalize")}
          className="mb-6 flex items-center gap-1 text-sm text-gray-500 hover:text-black"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to finalize
        </button>

        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Vehicle Handover</h1>
            <p className="mt-2 text-gray-600">
              {reservation.customer.first_name}{" "}
              {reservation.customer.last_name} · {reservation.car.make}{" "}
              {reservation.car.model} · {reservation.car.license_plate}
            </p>
          </div>

          <ReservationStatusBadge status={reservation.status} />
        </div>

        {agreementDone ? (
          <Card className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-black text-white">
              <Check className="h-6 w-6" />
            </div>

            <h2 className="text-xl font-semibold">Handover complete</h2>

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
                className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
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
                  <p className="text-sm text-gray-700">
                    Payment received
                    {handover.payment_amount !== null &&
                      ` — ${handover.payment_amount.toFixed(2)} ${handover.payment_currency?.toUpperCase()}`}
                    .
                  </p>
                ) : paymentIntentError ? (
                  <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700">
                    {paymentIntentError}
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
                    onPaid={handlePaid}
                  />
                ) : (
                  <p className="text-sm text-gray-500">
                    Preparing payment...
                  </p>
                )}
              </div>
            </Card>

            {/* Step 2: Signature */}
            <Card className={signatureStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader
                index={2}
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
                  <p className="text-sm text-gray-400">
                    Complete payment first.
                  </p>
                )}
              </div>
            </Card>

            {/* Step 3: Generate agreement */}
            <Card className={agreementStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader
                index={3}
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
                  <p className="text-sm text-gray-400">
                    Capture the customer&apos;s signature first.
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
