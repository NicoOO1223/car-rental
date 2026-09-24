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
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/handover/SignaturePad";
import { StepHeader, type StepStatus } from "@/components/handover/StepHeader";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";

type Props = {
  params: Promise<{ id: string }>;
};

const FUEL_OPTIONS = Array.from({ length: 9 }, (_, index) => 8 - index).map(
  (eighths) => ({
    value: String(eighths),
    label:
      eighths === 8
        ? "Full (8/8)"
        : eighths === 0
          ? "Empty (0/8)"
          : `${eighths}/8`,
  }),
);

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
        } else if (carData.mileage !== null) {
          setMileage(String(carData.mileage));
        }
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : "Failed to load check-out.",
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
            error instanceof Error ? error.message : "Failed to start payment.",
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
      });

      setCheckOut(saved);
      setWaiveLate(false);
      setWaiveFuel(false);
      setWaiveReason("");
    } catch (error) {
      setConditionError(
        error instanceof Error ? error.message : "Failed to save the condition.",
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
        error instanceof Error ? error.message : "Failed to update the charges.",
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
        error instanceof Error ? error.message : "Failed to settle the deposit.",
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
      setSignatureError("Please sign before continuing.");
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
        error instanceof Error ? error.message : "Failed to save the signature.",
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
        error instanceof Error ? error.message : "Failed to complete the check-out.",
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
            className="mb-6 flex items-center gap-1 text-sm text-gray-500 hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to handovers
          </button>

          <p className="text-red-600">{loadError || "Reservation not found."}</p>
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
            <h1 className="text-3xl font-bold">Vehicle Check-out</h1>
            <p className="mt-2 text-gray-600">
              {reservation.customer.first_name} {reservation.customer.last_name}{" "}
              · {reservation.car.make} {reservation.car.model} ·{" "}
              {reservation.car.license_plate}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Due back {formatDateTime(reservation.return_at)} at{" "}
              {reservation.return_location.airport_code}
            </p>
          </div>

          <ReservationStatusBadge status={reservation.status} />
        </div>

        {notOut ? (
          <Card>
            <p className="text-sm text-gray-700">
              This rental is {reservation.status.toLowerCase()}, so it can&apos;t
              be checked out.
            </p>
          </Card>
        ) : completed ? (
          <Card className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-900 text-white">
              <Check className="h-6 w-6" />
            </div>

            <h2 className="text-xl font-semibold">Check-out complete</h2>

            <p className="mt-2 text-sm text-gray-600">
              The rental is completed and the vehicle is back.
            </p>

            {result?.car_away_from_home && (
              <div
                className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  This car is now at {result.car_current_airport_code} but
                  belongs at {result.car_home_airport_code}. It is flagged on
                  the dashboard until it has been moved back.
                </span>
              </div>
            )}

            {result?.maintenance_task_id && (
              <p className="mt-4 text-sm text-gray-700">
                Damage was reported, so a repair task was opened and the car is
                out of service for the repair period.
              </p>
            )}

            <div className="mt-6 flex justify-center gap-3">
              <Button
                variant="secondary"
                onClick={() => navigate(`/reservations/manage/${reservation.id}`)}
              >
                View Reservation
              </Button>

              <Button onClick={() => navigate("/handovers?tab=check-out")}>
                Back to handovers
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Step 1: Vehicle condition */}
            <Card>
              <StepHeader index={1} title="Vehicle Condition" status={conditionStatus} />

              <form onSubmit={handleSaveCondition} className="mt-5 space-y-4">
                {pastScheduledReturn && !conditionSaved && (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                    This rental is past its scheduled return. Lateness is
                    counted up to the moment you save the condition.
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Mileage (km)"
                    type="number"
                    min={car.mileage ?? 0}
                    required
                    disabled={!editable}
                    hint={
                      car.mileage !== null
                        ? `Currently recorded: ${car.mileage.toLocaleString()} km`
                        : undefined
                    }
                    value={mileage}
                    onChange={(event) => setMileage(event.target.value)}
                  />

                  <SelectField
                    label="Fuel level"
                    disabled={!editable}
                    hint="Cars go out with a full tank."
                    value={fuel}
                    onChange={(event) => setFuel(event.target.value)}
                  >
                    {FUEL_OPTIONS.map((option) => (
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
                  />
                  The vehicle has damage
                </label>

                {damageReported && (
                  <div className="space-y-4 rounded-lg border border-border-strong p-4">
                    <Field label="Describe the damage">
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
                      label="Damage charge"
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!editable}
                      hint="Charged to the customer now. Leave at 0 for no charge."
                      value={damageCharge}
                      onChange={(event) => setDamageCharge(event.target.value)}
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        label="Out of service from"
                        type="datetime-local"
                        required
                        disabled={!editable}
                        value={repairStart}
                        onChange={(event) => setRepairStart(event.target.value)}
                      />

                      <TextField
                        label="Back in service at"
                        type="datetime-local"
                        required
                        disabled={!editable}
                        min={repairStart}
                        value={repairEnd}
                        onChange={(event) => setRepairEnd(event.target.value)}
                      />
                    </div>

                    <p className="text-xs text-ink-muted">
                      A repair task is opened for this period when the
                      check-out is completed.
                    </p>
                  </div>
                )}

                {conditionError && (
                  <p className="text-sm text-red-600" role="alert">
                    {conditionError}
                  </p>
                )}

                {editable && (
                  <Button type="submit" disabled={savingCondition}>
                    {savingCondition
                      ? "Saving..."
                      : conditionSaved
                        ? "Update condition"
                        : "Save condition"}
                  </Button>
                )}
              </form>
            </Card>

            {/* Step 2: Charges & payment */}
            <Card className={paymentStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader index={2} title="Deposit & Charges" status={paymentStatus} />

              <div className="mt-5">
                {!checkOut ? (
                  <p className="text-sm text-ink-muted">
                    Record the vehicle&apos;s condition first.
                  </p>
                ) : (
                  <div className="space-y-5">
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between gap-4">
                        <dt className="text-ink-muted">
                          Returned {formatDateTime(checkOut.returned_at)}
                          {checkOut.late_hours > 0 &&
                            ` — ${checkOut.late_hours} started hour${checkOut.late_hours === 1 ? "" : "s"} late`}
                        </dt>
                        <dd className={checkOut.late_fee_waived ? "line-through" : ""}>
                          {money(checkOut.late_fee, checkOut.payment_currency)}
                        </dd>
                      </div>

                      <div className="flex justify-between gap-4">
                        <dt className="text-ink-muted">
                          Fuel ({checkOut.fuel_eighths}/8)
                        </dt>
                        <dd className={checkOut.fuel_fee_waived ? "line-through" : ""}>
                          {money(checkOut.fuel_fee, checkOut.payment_currency)}
                        </dd>
                      </div>

                      <div className="flex justify-between gap-4">
                        <dt className="text-ink-muted">Damage</dt>
                        <dd>{money(checkOut.damage_charge, checkOut.payment_currency)}</dd>
                      </div>

                      <div className="flex justify-between gap-4 border-t border-border-strong pt-2 font-semibold">
                        <dt>Total due</dt>
                        <dd>{money(checkOut.total_charge, checkOut.payment_currency)}</dd>
                      </div>
                    </dl>

                    {editable && (checkOut.late_fee > 0 || checkOut.fuel_fee > 0) && (
                      <div className="space-y-3 rounded-lg bg-surface-sunken p-4">
                        <p className="text-sm font-medium text-ink">Waive a charge</p>

                        {checkOut.late_fee > 0 && (
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={waiveLate}
                              onChange={(event) => setWaiveLate(event.target.checked)}
                            />
                            Waive the late fee
                          </label>
                        )}

                        {checkOut.fuel_fee > 0 && (
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={waiveFuel}
                              onChange={(event) => setWaiveFuel(event.target.checked)}
                            />
                            Waive the fuel fee
                          </label>
                        )}

                        <TextField
                          label="Reason"
                          hint="Required when waiving. Recorded in the audit log."
                          value={waiveReason}
                          onChange={(event) => setWaiveReason(event.target.value)}
                        />

                        {waiveError && (
                          <p className="text-sm text-red-600" role="alert">
                            {waiveError}
                          </p>
                        )}

                        <Button
                          variant="secondary"
                          onClick={handleWaive}
                          disabled={waiving}
                        >
                          {waiving ? "Saving..." : "Apply"}
                        </Button>
                      </div>
                    )}

                    {checkOut.waiver_reason && !editable && (
                      <p className="text-sm text-ink-muted">
                        Waived: {checkOut.waiver_reason}
                      </p>
                    )}

                    {checkOut.deposit_pending && checkOut.deposit_amount !== null && (
                      <div className="space-y-3 rounded-lg border border-border-strong p-4">
                        <p className="text-sm font-medium text-ink">Security deposit</p>

                        <p className="text-sm text-gray-700">
                          A {checkOut.deposit_method === "CASH" ? "cash" : "card"} deposit of{" "}
                          {money(checkOut.deposit_amount, checkOut.payment_currency)} is held.
                          The charges (
                          {money(checkOut.total_charge, checkOut.payment_currency)}) are
                          taken from it first:{" "}
                          {money(
                            Math.min(checkOut.total_charge, checkOut.deposit_amount),
                            checkOut.payment_currency,
                          )}{" "}
                          kept,{" "}
                          {money(
                            Math.max(checkOut.deposit_amount - checkOut.total_charge, 0),
                            checkOut.payment_currency,
                          )}{" "}
                          {checkOut.deposit_method === "CASH"
                            ? "handed back in cash"
                            : "released to the card"}
                          {checkOut.total_charge > checkOut.deposit_amount &&
                            `, and ${money(
                              checkOut.total_charge - checkOut.deposit_amount,
                              checkOut.payment_currency,
                            )} still to collect`}
                          .
                        </p>

                        <p className="text-xs text-ink-muted">
                          Settling locks the figures above, so waive anything
                          first.
                        </p>

                        {depositError && (
                          <p className="text-sm text-red-600" role="alert">
                            {depositError}
                          </p>
                        )}

                        <Button onClick={handleSettleDeposit} disabled={settlingDeposit}>
                          {settlingDeposit ? "Settling..." : "Settle deposit"}
                        </Button>
                      </div>
                    )}

                    {checkOut.deposit_settled_at && checkOut.deposit_held && (
                      <p className="text-sm text-gray-700">
                        {checkOut.deposit_status === "LAPSED"
                          ? "The card hold had expired, so nothing could be taken from it."
                          : `Deposit settled: ${money(
                              checkOut.deposit_applied,
                              checkOut.payment_currency,
                            )} kept for the charges`}
                        {checkOut.deposit_returned > 0 &&
                          (checkOut.deposit_method === "CASH"
                            ? ` — hand back ${money(checkOut.deposit_returned, checkOut.payment_currency)} in cash.`
                            : `, ${money(checkOut.deposit_returned, checkOut.payment_currency)} released to the card.`)}
                        {checkOut.deposit_returned <= 0 &&
                          checkOut.deposit_status !== "LAPSED" &&
                          "."}
                      </p>
                    )}

                    {checkOut.deposit_pending ? null : amountDue <= 0 ? (
                      <p className="text-sm text-gray-700">
                        No charges to collect.
                      </p>
                    ) : checkOut.payment_status === "SUCCEEDED" ? (
                      <p className="text-sm text-gray-700">
                        Payment received (
                        {checkOut.payment_method === "CASH" ? "Cash" : "Card"}) —{" "}
                        {money(checkOut.payment_amount ?? 0, checkOut.payment_currency)}.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {paymentIntentError && (
                          <p className="rounded-lg bg-gray-100 p-3 text-sm text-gray-700">
                            {paymentIntentError} Card payment may be unavailable,
                            but you can still take cash.
                          </p>
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
              <StepHeader index={3} title="Employee Signature" status={signatureStatus} />

              <div className="mt-5">
                {signatureDone && checkOut ? (
                  <p className="text-sm text-gray-700">
                    Received by {checkOut.employee_signed_by_email ?? "an employee"}
                    {checkOut.employee_signed_at &&
                      ` on ${formatDateTime(checkOut.employee_signed_at)}`}
                    .
                  </p>
                ) : signatureStatus === "active" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      The employee receiving the vehicle signs to confirm the
                      condition recorded above.
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
                    Record the condition and settle any charges first.
                  </p>
                )}
              </div>
            </Card>

            {/* Step 4: Complete */}
            <Card className={completeStatus === "locked" ? "opacity-50" : ""}>
              <StepHeader index={4} title="Complete Check-out" status={completeStatus} />

              <div className="mt-5">
                {completeStatus === "active" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      This completes the rental and moves the vehicle to{" "}
                      {reservation.return_location.airport_code}
                      {damageReported
                        ? ", where a repair task will be opened"
                        : " as available"}
                      .
                    </p>

                    {completeError && (
                      <p className="text-sm text-red-600" role="alert">
                        {completeError}
                      </p>
                    )}

                    <Button onClick={handleComplete} disabled={completing} fullWidth>
                      {completing ? "Completing..." : "Complete Check-out"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">
                    Finish the steps above first.
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
