"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Banknote, Check, CreditCard } from "lucide-react";

import {
  createPaymentIntent,
  generateAgreement,
  downloadAgreement,
  getAgreementTerms,
  getHandover,
  getIdentityDetails,
  getPaymentSummary,
  getPublicConfiguration,
  getReservation,
  submitEmployeeSignature,
  submitSignature,
  type AgreementTerms,
  type Handover,
  type IdentityDetails,
  type PaymentIntent,
  type PaymentSummary,
  type Reservation,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { CashPaymentForm, PaymentStep, PrepaidSettleForm } from "@/components/handover/PaymentStep";
import { ConditionReviewStep } from "@/components/handover/ConditionReviewStep";
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
import { t } from "@/lib/i18n";

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
  const [summary, setSummary] = useState<PaymentSummary | null>(null);

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

  // The terms the customer reads before signing, and whether they said they did.
  const [terms, setTerms] = useState<AgreementTerms | null>(null);
  const [termsError, setTermsError] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

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

        // Without the terms on screen the customer would sign unread, so a
        // failure here keeps the signature step closed instead of failing quietly.
        try {
          setTerms(await getAgreementTerms(id));
        } catch (termsLoadError) {
          setTermsError(
            termsLoadError instanceof Error
              ? termsLoadError.message
              : t("s.handovers.id.checkIn.failedLoadTerms"),
          );
        }

        const summaryData = await getPaymentSummary(id);
        setSummary(summaryData);

        // A rental paid in full online has nothing to charge, so no card
        // payment is prepared for it.
        if (handoverData.payment_status !== "SUCCEEDED" && summaryData.amount_due > 0) {
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
                : t("s.handovers.id.checkIn.failedStartPayment"),
            );
          }
        }
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : t("s.handovers.id.checkIn.failedLoadHandover"),
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

    if (!terms || !termsAccepted) {
      setSignatureError(t("s.handovers.id.checkIn.termsMustBeAccepted"));
      return;
    }

    if (signaturePadRef.current.isEmpty()) {
      setSignatureError(t("s.handovers.id.checkIn.pleaseHaveCustomerSign"));
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
        error instanceof Error ? error.message : t("s.handovers.id.checkIn.failedSaveSignature"),
      );
    } finally {
      setSigning(false);
    }
  }

  async function handleSaveEmployeeSignature() {
    if (!reservationId || !employeeSignaturePadRef.current) return;

    if (employeeSignaturePadRef.current.isEmpty()) {
      setEmployeeSignatureError(t("s.handovers.id.checkIn.pleaseSignBeforeContinuing"));
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
          : t("s.handovers.id.checkIn.failedSaveEmployeeSignature"),
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
          : t("s.handovers.id.checkIn.failedGenerateAgreement"),
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
            <ArrowLeft className="h-4 w-4" />{t("s.handovers.id.checkIn.backHandovers")}</button>

          <p className="text-red-600">
            {loadError || t("s.handovers.id.checkIn.reservationNotFound")}
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
            <ArrowLeft className="h-4 w-4" />{t("s.handovers.id.checkIn.backHandovers")}</button>

          <button
            onClick={() => navigate(`/reservations/manage/${reservation.id}`)}
            className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-black"
          >{t("s.handovers.id.checkIn.viewChangeReservation")}<ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t("s.handovers.id.checkIn.vehicleCheck")}</h1>
            <p className="mt-2 text-gray-600">
              {reservation.customer.first_name}{" "}
              {reservation.customer.last_name} · {reservation.car.make}{" "}
              {reservation.car.model} · {reservation.car.license_plate}
            </p>
            <p className="mt-1 text-sm text-gray-500">{t("s.handovers.id.checkIn.booked", { v1: formatDateTime(reservation.created_at) })}</p>
          </div>

          <ReservationStatusBadge status={reservation.status} />
        </div>

        <div className="mb-6">
          <ConditionReviewStep reservationId={reservation.id} kind="CHECK_IN" />
        </div>

        {agreementDone ? (
          <Card className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-900 text-white">
              <Check className="h-6 w-6" />
            </div>

            <h2 className="text-xl font-semibold">{t("s.handovers.id.checkIn.checkComplete")}</h2>

            <p className="mt-2 text-sm text-gray-600">{t("s.handovers.id.checkIn.rentalAgreementHasBeen")}</p>

            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() =>
                  downloadAgreement(
                    reservation.id,
                    `agreement-${reservation.id}.pdf`,
                  )
                }
                className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
              >{t("s.handovers.id.checkIn.downloadAgreement")}</button>

              <Button
                variant="secondary"
                onClick={() =>
                  navigate(`/reservations/manage/${reservation.id}`)
                }
              >{t("s.handovers.id.checkIn.viewReservation")}</Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Step 1: Payment */}
            <Card>
              <StepHeader index={1} title={t("s.handovers.id.checkIn.payment")} status={paymentStatus} />

              <div className="mt-5">
                {paymentDone && handover.payment_method === "PREPAID" ? (
                  <p className="flex items-center gap-1.5 text-sm text-gray-700">
                    <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {t("s.handovers.id.checkIn.paidInFullOnline", {
                      amount: `${(summary?.paid_online ?? 0).toFixed(2)} ${summary?.currency.toUpperCase() ?? ""}`,
                    })}
                  </p>
                ) : paymentDone ? (
                  <p className="flex items-center gap-1.5 text-sm text-gray-700">
                    {handover.payment_method === "CASH" ? (
                      <Banknote className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
                    )}{handover.payment_method && handover.payment_amount !== null
                      ? t("s.handovers.id.checkIn.paymentReceivedVia", {
                          method: t(handover.payment_method === "CASH" ? "common.cash" : "common.card"),
                          amount: `${handover.payment_amount.toFixed(2)} ${handover.payment_currency?.toUpperCase() ?? ""}`,
                        })
                      : t("s.handovers.id.checkIn.paymentReceived")}</p>
                ) : summary && summary.amount_due === 0 && summary.paid_online > 0 ? (
                  <PrepaidSettleForm
                    reservationId={reservation.id}
                    paidOnline={summary.paid_online}
                    currency={summary.currency}
                    onPaid={handlePaid}
                  />
                ) : paymentIntentError ? (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700">{t("s.handovers.id.checkIn.cardPaymentUnavailableBut", { paymentIntentError })}</div>
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
                    paidOnline={summary?.paid_online ?? 0}
                    onPaid={handlePaid}
                  />
                ) : (
                  <p className="text-sm text-gray-500">{t("s.handovers.id.checkIn.preparingPayment")}</p>
                )}
              </div>
            </Card>

            {/* Step 2: Security deposit (only when deposits are on) */}
            {depositRequired && (
              <Card className={depositStatus === "locked" ? "opacity-50" : ""}>
                <StepHeader index={2} title={t("s.handovers.id.checkIn.securityDeposit")} status={depositStatus} />

                <div className="mt-5">
                  {depositDone ? (
                    <p className="text-sm text-gray-700">{handover.deposit_amount !== null
                      ? t("s.handovers.id.checkIn.depositHeldAmount", {
                          method: t(handover.deposit_method === "CASH" ? "common.cash" : "common.cardHold"),
                          amount: `${handover.deposit_amount.toFixed(2)} ${handover.deposit_currency?.toUpperCase() ?? ""}`,
                        })
                      : t("s.handovers.id.checkIn.depositHeld", {
                          method: t(handover.deposit_method === "CASH" ? "common.cash" : "common.cardHold"),
                        })}</p>
                  ) : depositStatus === "active" ? (
                    <DepositStep
                      reservationId={reservation.id}
                      amount={handover.deposit_amount ?? depositAmount}
                      currency={handover.deposit_currency}
                      onHeld={handlePaid}
                    />
                  ) : (
                    <p className="text-sm text-ink-muted">{t("s.handovers.id.checkIn.completePaymentFirst")}</p>
                  )}
                </div>
              </Card>
            )}

            {/* Identity verification */}
            <Card className={identityStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader
                index={identityIndex}
                title={t("s.handovers.id.checkIn.identityDrivingLicence")}
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
                  <p className="text-sm text-ink-muted">{t(depositRequired ? "s.handovers.id.checkIn.completePaymentDepositFirst" : "s.handovers.id.checkIn.completePaymentFirst")}</p>
                )}
              </div>
            </Card>

            {/* Step 3: Signature */}
            <Card className={signatureStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader
                index={identityIndex + 1}
                title={t("s.handovers.id.checkIn.customerSignature")}
                status={signatureStatus}
              />

              <div className="mt-5">
                {signatureDone ? (
                  <p className="text-sm text-gray-700">{t("s.handovers.id.checkIn.signatureCaptured")}</p>
                ) : signatureStatus === "active" ? (
                  <div className="space-y-4">
                    {termsError ? (
                      <p className="text-sm text-red-600" role="alert">{termsError}</p>
                    ) : terms ? (
                      <div>
                        <h3 className="text-sm font-semibold text-ink">{terms.title}</h3>

                        {terms.is_placeholder && (
                          <p className="mt-1 text-sm text-amber-700">
                            {t("s.handovers.id.checkIn.placeholderTermsWarning")}
                          </p>
                        )}

                        {/* Focusable, so a keyboard user can scroll it. */}
                        <div
                          tabIndex={0}
                          role="region"
                          aria-label={terms.title}
                          className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border-subtle bg-canvas p-3 text-sm text-ink"
                        >
                          {terms.terms}
                        </div>

                        <label className="mt-3 flex items-start gap-3 text-sm">
                          <input
                            type="checkbox"
                            checked={termsAccepted}
                            onChange={(event) => setTermsAccepted(event.target.checked)}
                            className="mt-0.5 h-4 w-4 accent-gray-900"
                          />
                          <span>{t("s.handovers.id.checkIn.customerAcceptsTerms")}</span>
                        </label>
                      </div>
                    ) : (
                      <p className="text-sm text-ink-muted">{t("s.handovers.id.checkIn.loadingTerms")}</p>
                    )}

                    <p className="text-sm text-gray-600">{t("s.handovers.id.checkIn.haveCustomerSignBelow")}</p>

                    <SignaturePad ref={signaturePadRef} />

                    {signatureError && (
                      <p className="text-sm text-red-600">{signatureError}</p>
                    )}

                    <div className="flex gap-3">
                      <Button
                        variant="secondary"
                        onClick={() => signaturePadRef.current?.clear()}
                      >{t("s.handovers.id.checkIn.clear")}</Button>

                      <Button onClick={handleSaveSignature} disabled={signing || !terms || !termsAccepted}>
                        {signing ? t("s.handovers.id.checkIn.saving") : t("s.handovers.id.checkIn.saveSignature")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">{t("s.handovers.id.checkIn.verifyCustomerSIdentity")}</p>
                )}
              </div>
            </Card>

            {/* Step 4: Employee signature */}
            <Card
              className={employeeSignatureStatus === "locked" ? "opacity-50" : ""}
            >
              <StepHeader
                index={identityIndex + 2}
                title={t("s.handovers.id.checkIn.employeeSignature")}
                status={employeeSignatureStatus}
              />

              <div className="mt-5">
                {employeeSignatureDone ? (
                  <p className="text-sm text-gray-700">{handover.employee_signed_at
                      ? t("s.handovers.id.checkIn.signedByOn", {
                          who: handover.employee_signed_by_email ?? t("common.anEmployee"),
                          date: formatDateTime(handover.employee_signed_at),
                        })
                      : t("s.handovers.id.checkIn.signedBy", {
                          who: handover.employee_signed_by_email ?? t("common.anEmployee"),
                        })}</p>
                ) : employeeSignatureStatus === "active" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">{t("s.handovers.id.checkIn.approvingEmployeeSignsBelow")}</p>

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
                      >{t("s.handovers.id.checkIn.clear")}</Button>

                      <Button
                        onClick={handleSaveEmployeeSignature}
                        disabled={employeeSigning}
                      >
                        {employeeSigning ? t("s.handovers.id.checkIn.saving") : t("s.handovers.id.checkIn.saveSignature")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">{t("s.handovers.id.checkIn.captureCustomerSSignature")}</p>
                )}
              </div>
            </Card>

            {/* Step 5: Generate agreement */}
            <Card className={agreementStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader
                index={identityIndex + 3}
                title={t("s.handovers.id.checkIn.generateAgreement")}
                status={agreementStatus}
              />

              <div className="mt-5">
                {agreementStatus === "active" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">{t("s.handovers.id.checkIn.willGenerateRentalAgreement")}</p>

                    {generateError && (
                      <p className="text-sm text-red-600">{generateError}</p>
                    )}

                    <Button onClick={handleGenerateAgreement} disabled={generating} fullWidth>
                      {generating
                        ? t("s.handovers.id.checkIn.generating")
                        : t("s.handovers.id.checkIn.generateAgreementStartRental")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">{t("s.handovers.id.checkIn.completeCustomerEmployeeSignatures")}</p>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
