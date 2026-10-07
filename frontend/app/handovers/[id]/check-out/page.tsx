"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check } from "lucide-react";

import {
  completeCheckOut,
  createCheckOutPaymentIntent,
  getCar,
  getCheckOut,
  getReservation,
  saveCheckOutCondition,
  settleCheckOutDeposit,
  submitCheckOutEmployeeSignature,
  waiveCheckOutCharges,
  type Car,
  type CheckOut,
  type CheckOutPaymentIntent,
  type CheckOutResult,
  type Reservation,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { Field, SelectField, Textarea, TextField } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { CheckOutPaymentStep } from "@/components/handover/CheckOutPaymentStep";
import { ConditionReviewStep } from "@/components/handover/ConditionReviewStep";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/handover/SignaturePad";
import { StepHeader, type StepStatus } from "@/components/handover/StepHeader";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { can } from "@/lib/permissions";
import { CLEANING_TYPES } from "@/lib/maintenance";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { enumLabelLower, t } from "@/lib/i18n";

type Props = {
  params: Promise<{ id: string }>;
};

// A function, not a constant: the labels must be read in the language showing when drawn.
function fuelOptions() {
  return Array.from({ length: 9 }, (_, index) => 8 - index).map((eighths) => ({
    value: String(eighths),
    label:
      eighths === 8
        ? t("s.handovers.id.checkOut.full88")
        : eighths === 0
          ? t("s.handovers.id.checkOut.empty08")
          : `${eighths}/8`,
  }));
}

/** A Date as the value of a datetime-local input (local time). */
function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function money(amount: number, currency?: string | null): string {
  return formatCurrency(amount, currency?.toUpperCase());
}

export default function CheckOutPage({ params }: Props) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  // Waiving a fee and settling the deposit are a manager's approvals.
  const canApprove = can(user?.role, "money.approve");

  const [reservationId, setReservationId] = useState<string | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [car, setCar] = useState<Car | null>(null);
  const [checkOut, setCheckOut] = useState<CheckOut | null>(null);
  const [result, setResult] = useState<CheckOutResult | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Step 1 form
  const [mileage, setMileage] = useState("");
  const [fuel, setFuel] = useState("8");
  const [damageReported, setDamageReported] = useState(false);
  const [damageNotes, setDamageNotes] = useState("");
  const [damageCharge, setDamageCharge] = useState("0");
  const [repairStart, setRepairStart] = useState(() => toLocalInput(new Date()));
  const [repairEnd, setRepairEnd] = useState(() =>
    toLocalInput(new Date(Date.now() + 3 * 86_400_000)),
  );
  const [sendForCleaning, setSendForCleaning] = useState(false);
  const [cleaningType, setCleaningType] = useState("");
  const [cleaningStart, setCleaningStart] = useState(() => toLocalInput(new Date()));
  const [cleaningEnd, setCleaningEnd] = useState(() =>
    toLocalInput(new Date(Date.now() + 4 * 3_600_000)),
  );
  const [savingCondition, setSavingCondition] = useState(false);
  const [conditionError, setConditionError] = useState("");

  // Waivers
  const [waiveLate, setWaiveLate] = useState(false);
  const [waiveFuel, setWaiveFuel] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");
  const [waiving, setWaiving] = useState(false);
  const [waiveError, setWaiveError] = useState("");

  // Payment
  const [paymentIntent, setPaymentIntent] =
    useState<CheckOutPaymentIntent | null>(null);
  const [paymentIntentError, setPaymentIntentError] = useState("");

  // Signature and completion
  const signaturePadRef = useRef<SignaturePadHandle>(null);
  const [signing, setSigning] = useState(false);
  const [signatureError, setSignatureError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");

  // A snapshot, so the "past its scheduled return" note is stable.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    async function load() {
      try {
        const { id } = await params;
        setReservationId(id);

        const [reservationData, checkOutData] = await Promise.all([
          getReservation(id),
          getCheckOut(id),
        ]);

        const carData = await getCar(reservationData.car.id);

        setReservation(reservationData);
        setCar(carData);
        setCheckOut(checkOutData);

        if (checkOutData) {
          setMileage(String(checkOutData.return_mileage));
          setFuel(String(checkOutData.fuel_eighths));
          setDamageReported(checkOutData.damage_reported);
          setDamageNotes(checkOutData.damage_notes ?? "");
          setDamageCharge(String(checkOutData.damage_charge));
          setWaiveLate(checkOutData.late_fee_waived);
          setWaiveFuel(checkOutData.fuel_fee_waived);
          setWaiveReason(checkOutData.waiver_reason ?? "");

          if (checkOutData.damage_task_starts_at) {
            setRepairStart(toLocalInput(new Date(checkOutData.damage_task_starts_at)));
          }

          if (checkOutData.damage_task_ends_at) {
            setRepairEnd(toLocalInput(new Date(checkOutData.damage_task_ends_at)));
          }

          setSendForCleaning(checkOutData.cleaning_requested);
          setCleaningType(checkOutData.cleaning_type ?? "");

          if (checkOutData.cleaning_task_starts_at) {
            setCleaningStart(toLocalInput(new Date(checkOutData.cleaning_task_starts_at)));
          }

          if (checkOutData.cleaning_task_ends_at) {
            setCleaningEnd(toLocalInput(new Date(checkOutData.cleaning_task_ends_at)));
          }
        } else if (carData.mileage !== null) {
          setMileage(String(carData.mileage));
        }
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : t("s.handovers.id.checkOut.failedLoadCheckOut"),
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [params]);

  // What is left after any held deposit has covered what it can.
  const amountDue = checkOut?.amount_due ?? 0;

  const needsPayment =
    checkOut !== null &&
    amountDue > 0 &&
    !checkOut.deposit_pending &&
    checkOut.payment_status !== "SUCCEEDED" &&
    !checkOut.has_employee_signature &&
    checkOut.completed_at === null;

  // The intent is (re)created whenever the amount due changes, e.g. after a
  // waiver; the server reuses the live one when the amount is unchanged.
  useEffect(() => {
    if (!needsPayment || !reservationId) return;

    let cancelled = false;

    async function startPayment() {
      try {
        const intent = await createCheckOutPaymentIntent(reservationId!);

        if (!cancelled) {
          setPaymentIntent(intent);
          setPaymentIntentError("");
        }
      } catch (error) {
        if (!cancelled) {
          setPaymentIntent(null);
          setPaymentIntentError(
            error instanceof Error ? error.message : t("s.handovers.id.checkOut.failedStartPayment"),
          );
        }
      }
    }

    startPayment();

    return () => {
      cancelled = true;
    };
  }, [needsPayment, amountDue, reservationId]);

  async function handleSaveCondition(event: React.FormEvent) {
    event.preventDefault();
    if (!reservationId) return;

    setSavingCondition(true);
    setConditionError("");

    try {
      const saved = await saveCheckOutCondition(reservationId, {
        return_mileage: Number(mileage),
        fuel_eighths: Number(fuel),
        damage_reported: damageReported,
        damage_notes: damageReported ? damageNotes : null,
        damage_charge: damageReported ? Number(damageCharge || 0) : 0,
        damage_task_starts_at: damageReported
          ? new Date(repairStart).toISOString()
          : null,
        damage_task_ends_at: damageReported
          ? new Date(repairEnd).toISOString()
          : null,
        send_for_cleaning: sendForCleaning,
        cleaning_type: sendForCleaning ? cleaningType || null : null,
        cleaning_task_starts_at: sendForCleaning
          ? new Date(cleaningStart).toISOString()
          : null,
        cleaning_task_ends_at: sendForCleaning
          ? new Date(cleaningEnd).toISOString()
          : null,
      });

      setCheckOut(saved);
      setWaiveLate(false);
      setWaiveFuel(false);
      setWaiveReason("");
    } catch (error) {
      setConditionError(
        error instanceof Error ? error.message : t("s.handovers.id.checkOut.failedSaveCondition"),
      );
    } finally {
      setSavingCondition(false);
    }
  }

  async function handleWaive() {
    if (!reservationId) return;

    setWaiving(true);
    setWaiveError("");

    try {
      setCheckOut(
        await waiveCheckOutCharges(reservationId, {
          waive_late_fee: waiveLate,
          waive_fuel_fee: waiveFuel,
          reason: waiveReason || null,
        }),
      );
    } catch (error) {
      setWaiveError(
        error instanceof Error ? error.message : t("s.handovers.id.checkOut.failedUpdateCharges"),
      );
    } finally {
      setWaiving(false);
    }
  }

  const [settlingDeposit, setSettlingDeposit] = useState(false);
  const [depositError, setDepositError] = useState("");

  async function handleSettleDeposit() {
    if (!reservationId) return;

    setSettlingDeposit(true);
    setDepositError("");

    try {
      setCheckOut(await settleCheckOutDeposit(reservationId));
    } catch (error) {
      setDepositError(
        error instanceof Error ? error.message : t("s.handovers.id.checkOut.failedSettleDeposit"),
      );
    } finally {
      setSettlingDeposit(false);
    }
  }

  async function handlePaid() {
    if (!reservationId) return;

    setCheckOut(await getCheckOut(reservationId));
  }

  async function handleSaveSignature() {
    if (!reservationId || !signaturePadRef.current) return;

    if (signaturePadRef.current.isEmpty()) {
      setSignatureError(t("s.handovers.id.checkOut.pleaseSignBeforeContinuing"));
      return;
    }

    setSigning(true);
    setSignatureError("");

    try {
      setCheckOut(
        await submitCheckOutEmployeeSignature(
          reservationId,
          signaturePadRef.current.toDataURL(),
        ),
      );
    } catch (error) {
      setSignatureError(
        error instanceof Error ? error.message : t("s.handovers.id.checkOut.failedSaveSignature"),
      );
    } finally {
      setSigning(false);
    }
  }

  async function handleComplete() {
    if (!reservationId) return;

    setCompleting(true);
    setCompleteError("");

    try {
      const done = await completeCheckOut(reservationId);

      setResult(done);
      setCheckOut(done.check_out);
      setReservation(await getReservation(reservationId));
    } catch (error) {
      setCompleteError(
        error instanceof Error ? error.message : t("s.handovers.id.checkOut.failedCompleteCheckOut"),
      );
    } finally {
      setCompleting(false);
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

  if (loadError || !reservation || !car) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          <button
            onClick={() => navigate("/handovers?tab=check-out")}
            className="mb-6 flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />{t("s.handovers.id.checkOut.backHandovers")}</button>

          <p className="text-danger">{loadError || t("s.handovers.id.checkOut.reservationNotFound")}</p>
        </div>
      </main>
    );
  }

  const completed = checkOut?.completed_at != null;
  const conditionSaved = checkOut !== null;
  const editable =
    !completed &&
    checkOut?.payment_status !== "SUCCEEDED" &&
    !checkOut?.has_employee_signature &&
    !checkOut?.deposit_settled_at;

  const paymentSettled =
    conditionSaved &&
    !checkOut?.deposit_pending &&
    (amountDue <= 0 || checkOut?.payment_status === "SUCCEEDED");
  const signatureDone = checkOut?.has_employee_signature ?? false;

  const conditionStatus: StepStatus = conditionSaved ? "done" : "active";
  const paymentStatus: StepStatus = paymentSettled
    ? "done"
    : conditionSaved
      ? "active"
      : "locked";
  const signatureStatus: StepStatus = signatureDone
    ? "done"
    : paymentSettled
      ? "active"
      : "locked";
  const completeStatus: StepStatus = completed
    ? "done"
    : signatureDone
      ? "active"
      : "locked";

  const scheduledReturn = new Date(reservation.return_at).getTime();
  const pastScheduledReturn = now > scheduledReturn;

  const notOut = reservation.status !== "ACTIVE" && !completed;

  return (
    <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <button
            onClick={() => navigate("/handovers?tab=check-out")}
            className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />{t("s.handovers.id.checkOut.backHandovers")}</button>

          <button
            onClick={() => navigate(`/reservations/manage/${reservation.id}`)}
            className="flex items-center gap-1 text-sm font-medium text-ink-secondary hover:text-ink"
          >{t("s.handovers.id.checkOut.viewChangeReservation")}<ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t("s.handovers.id.checkOut.vehicleCheckOut")}</h1>
            <p className="mt-2 text-ink-secondary">
              {reservation.customer.first_name} {reservation.customer.last_name}{" "}
              · {reservation.car.make} {reservation.car.model} ·{" "}
              {reservation.car.license_plate}
            </p>
            <p className="mt-1 text-sm text-ink-muted">{t("s.handovers.id.checkOut.dueBackAt", { v1: formatDateTime(reservation.return_at, reservation.return_location.timezone), airport_code: reservation.return_location.airport_code })}</p>
          </div>

          <ReservationStatusBadge status={reservation.status} />
        </div>

        {notOut ? (
          <Card>
            <p className="text-sm text-ink-secondary">{t("s.handovers.id.checkOut.rentalSoItCan", { status: enumLabelLower("reservationStatus", reservation.status) })}</p>
          </Card>
        ) : completed ? (
          <Card className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-on-accent">
              <Check className="h-6 w-6" />
            </div>

            <h2 className="text-xl font-semibold">{t("s.handovers.id.checkOut.checkOutComplete")}</h2>

            <p className="mt-2 text-sm text-ink-secondary">{t("s.handovers.id.checkOut.rentalCompletedVehicleBack")}</p>

            {result?.car_away_from_home && (
              <div
                className="mt-4 flex items-start gap-2 rounded-lg border border-warning-line bg-warning-soft p-3 text-left text-sm text-warning"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t("s.handovers.id.checkOut.carNowAtBut", { car_current_airport_code: result.car_current_airport_code, car_home_airport_code: result.car_home_airport_code })}</span>
              </div>
            )}

            {result?.maintenance_task_id && (
              <p className="mt-4 text-sm text-ink-secondary">{t("s.handovers.id.checkOut.damageWasReportedSo")}</p>
            )}

            {result?.cleaning_task_id && (
              <p className="mt-4 text-sm text-ink-secondary">{t("s.handovers.id.checkOut.carSentForCleaning")}</p>
            )}

            <div className="mt-6 flex justify-center gap-3">
              <Button
                variant="secondary"
                onClick={() => navigate(`/reservations/manage/${reservation.id}`)}
              >{t("s.handovers.id.checkOut.viewReservation")}</Button>

              <Button onClick={() => navigate("/handovers?tab=check-out")}>{t("s.handovers.id.checkOut.backHandovers")}</Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Step 1: Vehicle condition */}
            <Card>
              <StepHeader index={1} title={t("s.handovers.id.checkOut.vehicleCondition")} status={conditionStatus} />

              <form onSubmit={handleSaveCondition} className="mt-5 space-y-4">
                {pastScheduledReturn && !conditionSaved && (
                  <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">{t("s.handovers.id.checkOut.rentalPastItsScheduled")}</p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label={t("s.handovers.id.checkOut.mileageKm")}
                    type="number"
                    min={car.mileage ?? 0}
                    required
                    disabled={!editable}
                    hint={
                      car.mileage !== null
                        ? t("s.handovers.id.checkOut.currentlyRecordedKm", { v1: formatNumber(car.mileage) })
                        : undefined
                    }
                    value={mileage}
                    onChange={(event) => setMileage(event.target.value)}
                  />

                  <SelectField
                    label={t("s.handovers.id.checkOut.fuelLevel")}
                    disabled={!editable}
                    hint={t("s.handovers.id.checkOut.carsGoOutWith")}
                    value={fuel}
                    onChange={(event) => setFuel(event.target.value)}
                  >
                    {fuelOptions().map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectField>
                </div>

                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={!editable}
                    checked={damageReported}
                    onChange={(event) => setDamageReported(event.target.checked)}
                  />{t("s.handovers.id.checkOut.vehicleHasDamage")}</label>

                {damageReported && (
                  <div className="space-y-4 rounded-lg border border-border-strong p-4">
                    <Field label={t("s.handovers.id.checkOut.describeDamage")}>
                      {(fieldProps) => (
                        <Textarea
                          {...fieldProps}
                          rows={3}
                          required
                          disabled={!editable}
                          value={damageNotes}
                          onChange={(event) => setDamageNotes(event.target.value)}
                        />
                      )}
                    </Field>

                    <TextField
                      label={t("s.handovers.id.checkOut.damageCharge")}
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!editable}
                      hint={t("s.handovers.id.checkOut.chargedCustomerNowLeave")}
                      value={damageCharge}
                      onChange={(event) => setDamageCharge(event.target.value)}
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        label={t("s.handovers.id.checkOut.outServiceFrom")}
                        type="datetime-local"
                        required
                        disabled={!editable}
                        value={repairStart}
                        onChange={(event) => setRepairStart(event.target.value)}
                      />

                      <TextField
                        label={t("s.handovers.id.checkOut.backServiceAt")}
                        type="datetime-local"
                        required
                        disabled={!editable}
                        min={repairStart}
                        value={repairEnd}
                        onChange={(event) => setRepairEnd(event.target.value)}
                      />
                    </div>

                    <p className="text-xs text-ink-muted">{t("s.handovers.id.checkOut.repairTaskOpenedPeriod")}</p>
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={!editable}
                    checked={sendForCleaning}
                    onChange={(event) => setSendForCleaning(event.target.checked)}
                  />{t("s.handovers.id.checkOut.sendForCleaning")}</label>

                {sendForCleaning && (
                  <div className="space-y-4 rounded-lg border border-border-strong p-4">
                    <SelectField
                      label={t("s.handovers.id.checkOut.cleaningType")}
                      required
                      disabled={!editable}
                      value={cleaningType}
                      onChange={(event) => setCleaningType(event.target.value)}
                    >
                      <option value="">{t("s.handovers.id.checkOut.selectCleaningType")}</option>
                      {CLEANING_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SelectField>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        label={t("s.handovers.id.checkOut.outServiceFrom")}
                        type="datetime-local"
                        required
                        disabled={!editable}
                        value={cleaningStart}
                        onChange={(event) => setCleaningStart(event.target.value)}
                      />

                      <TextField
                        label={t("s.handovers.id.checkOut.backServiceAt")}
                        type="datetime-local"
                        required
                        disabled={!editable}
                        min={cleaningStart}
                        value={cleaningEnd}
                        onChange={(event) => setCleaningEnd(event.target.value)}
                      />
                    </div>

                    <p className="text-xs text-ink-muted">{t("s.handovers.id.checkOut.cleaningTaskOpenedPeriod")}</p>
                  </div>
                )}

                {conditionError && (
                  <p className="text-sm text-danger" role="alert">
                    {conditionError}
                  </p>
                )}

                {editable && (
                  <Button type="submit" disabled={savingCondition}>
                    {savingCondition
                      ? t("s.handovers.id.checkOut.saving")
                      : conditionSaved
                        ? t("s.handovers.id.checkOut.updateCondition")
                        : t("s.handovers.id.checkOut.saveCondition")}
                  </Button>
                )}
              </form>
            </Card>

            <ConditionReviewStep reservationId={reservation.id} kind="CHECK_OUT" />

            {/* Step 2: Charges & payment */}
            <Card className={paymentStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader index={2} title={t("s.handovers.id.checkOut.depositCharges")} status={paymentStatus} />

              <div className="mt-5">
                {!checkOut ? (
                  <p className="text-sm text-ink-muted">{t("s.handovers.id.checkOut.recordVehicleSCondition")}</p>
                ) : (
                  <div className="space-y-5">
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between gap-4">
                        <dt className="text-ink-muted">{checkOut.late_hours > 0
                          ? t("s.handovers.id.checkOut.returnedLate", { date: formatDateTime(checkOut.returned_at), hours: checkOut.late_hours })
                          : t("s.handovers.id.checkOut.returned", { date: formatDateTime(checkOut.returned_at) })}</dt>
                        <dd className={checkOut.late_fee_waived ? "line-through" : ""}>
                          {money(checkOut.late_fee, checkOut.payment_currency)}
                        </dd>
                      </div>

                      <div className="flex justify-between gap-4">
                        <dt className="text-ink-muted">{t("s.handovers.id.checkOut.fuel8", { fuel_eighths: checkOut.fuel_eighths })}</dt>
                        <dd className={checkOut.fuel_fee_waived ? "line-through" : ""}>
                          {money(checkOut.fuel_fee, checkOut.payment_currency)}
                        </dd>
                      </div>

                      <div className="flex justify-between gap-4">
                        <dt className="text-ink-muted">{t("s.handovers.id.checkOut.damage")}</dt>
                        <dd>{money(checkOut.damage_charge, checkOut.payment_currency)}</dd>
                      </div>

                      <div className="flex justify-between gap-4 border-t border-border-strong pt-2 font-semibold">
                        <dt>{t("s.handovers.id.checkOut.totalDue")}</dt>
                        <dd>{money(checkOut.total_charge, checkOut.payment_currency)}</dd>
                      </div>
                    </dl>

                    {editable && (checkOut.late_fee > 0 || checkOut.fuel_fee > 0) && !canApprove && (
                      <p className="rounded-lg bg-surface-sunken p-4 text-sm text-ink-secondary">
                        {t("s.handovers.id.checkOut.waiverNeedsManager")}
                      </p>
                    )}

                    {editable && (checkOut.late_fee > 0 || checkOut.fuel_fee > 0) && canApprove && (
                      <div className="space-y-3 rounded-lg bg-surface-sunken p-4">
                        <p className="text-sm font-medium text-ink">{t("s.handovers.id.checkOut.waiveCharge")}</p>

                        {checkOut.late_fee > 0 && (
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={waiveLate}
                              onChange={(event) => setWaiveLate(event.target.checked)}
                            />{t("s.handovers.id.checkOut.waiveLateFee")}</label>
                        )}

                        {checkOut.fuel_fee > 0 && (
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={waiveFuel}
                              onChange={(event) => setWaiveFuel(event.target.checked)}
                            />{t("s.handovers.id.checkOut.waiveFuelFee")}</label>
                        )}

                        <TextField
                          label={t("s.handovers.id.checkOut.reason")}
                          hint={t("s.handovers.id.checkOut.requiredWhenWaivingRecorded")}
                          value={waiveReason}
                          onChange={(event) => setWaiveReason(event.target.value)}
                        />

                        {waiveError && (
                          <p className="text-sm text-danger" role="alert">
                            {waiveError}
                          </p>
                        )}

                        <Button
                          variant="secondary"
                          onClick={handleWaive}
                          disabled={waiving}
                        >
                          {waiving ? t("s.handovers.id.checkOut.saving") : t("s.handovers.id.checkOut.apply")}
                        </Button>
                      </div>
                    )}

                    {checkOut.waiver_reason && !editable && (
                      <p className="text-sm text-ink-muted">{t("s.handovers.id.checkOut.waived", { waiver_reason: checkOut.waiver_reason })}</p>
                    )}

                    {checkOut.deposit_pending && checkOut.deposit_amount !== null && (
                      <div className="space-y-3 rounded-lg border border-border-strong p-4">
                        <p className="text-sm font-medium text-ink">{t("s.handovers.id.checkOut.securityDeposit")}</p>

                        <p className="text-sm text-ink-secondary">{t("s.handovers.id.checkOut.depositHeldChargesTaken", {
                          method: checkOut.deposit_method === "CASH" ? "CASH" : "CARD",
                          deposit: money(checkOut.deposit_amount, checkOut.payment_currency),
                          charges: money(checkOut.total_charge, checkOut.payment_currency),
                          kept: money(Math.min(checkOut.total_charge, checkOut.deposit_amount), checkOut.payment_currency),
                          back: money(Math.max(checkOut.deposit_amount - checkOut.total_charge, 0), checkOut.payment_currency),
                          owing:
                            checkOut.total_charge > checkOut.deposit_amount
                              ? money(checkOut.total_charge - checkOut.deposit_amount, checkOut.payment_currency)
                              : "none",
                        })}</p>

                        <p className="text-xs text-ink-muted">{t("s.handovers.id.checkOut.settlingLocksFiguresAbove")}</p>

                        {depositError && (
                          <p className="text-sm text-danger" role="alert">
                            {depositError}
                          </p>
                        )}

                        {!canApprove && (
                          <p className="text-sm text-ink-secondary">{t("s.handovers.id.checkOut.depositNeedsManager")}</p>
                        )}

                        <Button onClick={handleSettleDeposit} disabled={settlingDeposit || !canApprove}>
                          {settlingDeposit ? t("s.handovers.id.checkOut.settling") : t("s.handovers.id.checkOut.settleDeposit")}
                        </Button>
                      </div>
                    )}

                    {checkOut.deposit_settled_at && checkOut.deposit_held && (
                      <p className="text-sm text-ink-secondary">
                        {checkOut.deposit_status === "LAPSED"
                          ? t("s.handovers.id.checkOut.cardHoldHadExpired")
                          : t(
                              checkOut.deposit_returned > 0
                                ? checkOut.deposit_method === "CASH"
                                  ? "s.handovers.id.checkOut.depositSettledHandBack"
                                  : "s.handovers.id.checkOut.depositSettledReleased"
                                : "s.handovers.id.checkOut.depositSettled",
                              {
                                kept: money(checkOut.deposit_applied, checkOut.payment_currency),
                                returned: money(checkOut.deposit_returned, checkOut.payment_currency),
                              },
                            )}
                      </p>
                    )}

                    {checkOut.deposit_pending ? null : amountDue <= 0 ? (
                      <p className="text-sm text-ink-secondary">{t("s.handovers.id.checkOut.noChargesCollect")}</p>
                    ) : checkOut.payment_status === "SUCCEEDED" ? (
                      <p className="text-sm text-ink-secondary">{t("s.handovers.id.checkOut.paymentReceived", { method: t(checkOut.payment_method === "CASH" ? "common.cash" : "common.card"), amount: money(checkOut.payment_amount ?? 0, checkOut.payment_currency) })}</p>
                    ) : (
                      <div className="space-y-3">
                        {paymentIntentError && (
                          <p className="rounded-lg bg-surface-sunken p-3 text-sm text-ink-secondary">{t("s.handovers.id.checkOut.cardPaymentMayBe", { paymentIntentError })}</p>
                        )}

                        <CheckOutPaymentStep
                          reservationId={reservation.id}
                          clientSecret={paymentIntent?.client_secret ?? null}
                          amount={amountDue}
                          currency={checkOut.payment_currency}
                          onPaid={handlePaid}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* Step 3: Employee signature */}
            <Card className={signatureStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader index={3} title={t("s.handovers.id.checkOut.employeeSignature")} status={signatureStatus} />

              <div className="mt-5">
                {signatureDone && checkOut ? (
                  <p className="text-sm text-ink-secondary">{checkOut.employee_signed_at
                      ? t("s.handovers.id.checkOut.receivedByOn", {
                          who: checkOut.employee_signed_by_email ?? t("common.anEmployee"),
                          date: formatDateTime(checkOut.employee_signed_at),
                        })
                      : t("s.handovers.id.checkOut.receivedBy", {
                          who: checkOut.employee_signed_by_email ?? t("common.anEmployee"),
                        })}</p>
                ) : signatureStatus === "active" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-ink-secondary">{t("s.handovers.id.checkOut.employeeReceivingVehicleSigns")}</p>

                    <SignaturePad ref={signaturePadRef} />

                    {signatureError && (
                      <p className="text-sm text-danger">{signatureError}</p>
                    )}

                    <div className="flex gap-3">
                      <Button
                        variant="secondary"
                        onClick={() => signaturePadRef.current?.clear()}
                      >{t("s.handovers.id.checkOut.clear")}</Button>

                      <Button onClick={handleSaveSignature} disabled={signing}>
                        {signing ? t("s.handovers.id.checkOut.saving") : t("s.handovers.id.checkOut.saveSignature")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">{t("s.handovers.id.checkOut.recordConditionSettleAny")}</p>
                )}
              </div>
            </Card>

            {/* Step 4: Complete */}
            <Card className={completeStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader index={4} title={t("s.handovers.id.checkOut.completeCheckOut")} status={completeStatus} />

              <div className="mt-5">
                {completeStatus === "active" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-ink-secondary">{t(damageReported ? "s.handovers.id.checkOut.completesRepair" : "s.handovers.id.checkOut.completesAvailable", { airport_code: reservation.return_location.airport_code })}</p>

                    {completeError && (
                      <p className="text-sm text-danger" role="alert">
                        {completeError}
                      </p>
                    )}

                    <Button onClick={handleComplete} disabled={completing} fullWidth>
                      {completing ? t("s.handovers.id.checkOut.completing") : t("s.handovers.id.checkOut.completeCheckOut")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">{t("s.handovers.id.checkOut.finishStepsAboveFirst")}</p>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
