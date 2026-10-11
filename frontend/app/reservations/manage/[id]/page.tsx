"use client";

import { confirmReservationCar } from "@/lib/api";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronDown, CircleCheck, Pencil, Undo2 } from "lucide-react";

import {
  getReservation,
  getLocations,
  getCheckOut,
  getHandover,
  downloadAgreement,
  cancelReservation,
  markReservationNoShow,
  recordAdvanceReceived,
  resendPaymentRequest,
  extendPaymentWindow,
  getPaymentLink,
  type Reservation,
  type Location,
  type CheckOut,
  type Handover,
} from "@/lib/api";
import { InvoicesCard } from "@/components/invoices/InvoicesCard";
import { ReservationStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AdvancePaymentPanel, type AdvanceAction } from "@/components/reservations/AdvancePaymentPanel";
import { ApproveModal } from "@/components/reservations/ApproveModal";
import {
  ReservationCustomerCard,
  ReservationExtrasCard,
  ReservationVehicleCard,
} from "@/components/reservations/ReservationCards";
import { PriceAdjustmentModal } from "@/components/reservations/PriceAdjustmentModal";
import { ReservationEditModal } from "@/components/reservations/ReservationEditModal";
import { CancelWithRefundModal } from "@/components/reservations/CancelWithRefundModal";
import { OnlineBookingCard } from "@/components/reservations/OnlineBookingCard";
import { OverlappingReservationsCard } from "@/components/reservations/OverlappingReservationsCard";
import { SkeletonDetailPage } from "@/components/ui/Skeleton";
import {
  bookingReference,
  formatCurrency,
  formatDate,
  formatNumber,
  formatTime,
} from "@/lib/format";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { can } from "@/lib/permissions";
import { useNavigate } from "@/lib/useNavigate";
import { t } from "@/lib/i18n";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

const EDITABLE_STATUSES = new Set(["PENDING", "AWAITING_PAYMENT", "CONFIRMED", "ACTIVE"]);

export default function ReservationDetailsPage({
  params,
}: Props) {
  const navigate = useNavigate();
  // Whether this account may change things; the server refuses the rest anyway.
  const { user: currentUser } = useCurrentUser();
  const canWrite = can(currentUser?.role, "bookings.write");
  const [reservation, setReservation] =
    useState<Reservation | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [checkOut, setCheckOut] = useState<CheckOut | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

 const [cancelling, setCancelling] = useState(false);
 const [updatingStatus] = useState(false);
 const [editing, setEditing] = useState(false);
 const [adjustingPrice, setAdjustingPrice] = useState(false);
 const [approving, setApproving] = useState(false);
 const [paymentAction, setPaymentAction] = useState<AdvanceAction | "reopen" | null>(null);
 const paymentBusy = paymentAction !== null;
 const [paymentLink, setPaymentLink] = useState("");
 const [showApproval, setShowApproval] = useState(false);
 const [choosingRefund, setChoosingRefund] = useState(false);
 const [markingNoShow, setMarkingNoShow] = useState(false);
 const [showCheckOut, setShowCheckOut] = useState(false);

 const [actionError, setActionError] = useState("");
  useEffect(() => {
    async function loadReservation() {
      try {
        const { id } = await params;

        const [data, locationData] = await Promise.all([
          getReservation(id),
          getLocations(),
        ]);

        setReservation(data);
        setLocations(locationData);

        // A handover only exists once a reservation reaches CONFIRMED.
        // Asking for one on a PENDING booking is a guaranteed 400, so
        // skip the request rather than firing it and swallowing the
        // error — it was logging a console error on every pending
        // reservation anyone opened. CANCELLED is included despite that
        // same risk (a reservation cancelled while still PENDING never
        // got one either) because a reservation that reached the
        // counter, paid, and was *then* cancelled keeps its Handover
        // row — that's exactly where refund status lives. The catch
        // handles both the genuine race and the no-handover case.
        if (["CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED"].includes(data.status)) {
          try {
            setHandover(await getHandover(id));
          } catch {
            setHandover(null);
          }
        } else {
          setHandover(null);
        }

        // Only a returned rental has a completed check-out to show.
        if (data.status === "COMPLETED") {
          try {
            setCheckOut(await getCheckOut(id));
          } catch {
            setCheckOut(null);
          }
        }
      } catch {
        setError(t("s.reservations.manage.id.failedLoadReservation"));
      } finally {
        setLoading(false);
      }
    }

    loadReservation();
  }, [params]);

  // Dates and times come from lib/format.ts. Pickup and return are shown in
  // the timezone of the location they happen at (passed at each call).
  function formatDateTime(date: string, timeZone?: string) {
    return t("common.dateAtTime", { date: formatDate(date, timeZone), time: formatTime(date, timeZone) });
  }

  function getRentalDays(
    pickup: string,
    returnDate: string
  ) {
    const pickupDate = new Date(pickup);
    const returnAt = new Date(returnDate);

    const difference =
      returnAt.getTime() - pickupDate.getTime();

    return Math.ceil(
      difference / (1000 * 60 * 60 * 24)
    );
  }

  async function handleCancelReservation() {
    if (!reservation) {
      return;
    }

    // A renter who paid a share online: staff decide whether it goes back.
    if (reservation.prepayment?.payment_status === "SUCCEEDED") {
      setChoosingRefund(true);
      return;
    }

    const willRefund = handover?.payment_status === "SUCCEEDED";
    const confirmationMessage = willRefund
      ? t("s.reservations.manage.id.youSureYouWant", { amount: formatCurrency(
          handover!.payment_amount ?? 0,
          handover!.payment_currency ?? undefined,
        ), method: handover!.payment_method ?? "" })
      : t("s.reservations.manage.id.youSureYouWant2");

    const confirmed = window.confirm(confirmationMessage);

    if (!confirmed) {
      return;
    }

    setCancelling(true);
    setActionError("");

    try {
      const updatedReservation =
        await cancelReservation(reservation.id);

      setReservation(updatedReservation);

      if (willRefund) {
        setHandover(await getHandover(reservation.id));
      }
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : t("s.reservations.manage.id.failedCancelReservation")
      );
    } finally {
      setCancelling(false);
    }
  }
  
  async function handleNoShow() {
    if (!reservation) {
      return;
    }

    const paid = reservation.prepayment?.payment_status === "SUCCEEDED";
    const message = paid
      ? t("s.reservations.manage.id.confirmNoShowKeep", {
          amount: formatCurrency(
            Number(reservation.prepayment?.amount ?? 0),
            reservation.prepayment?.currency ?? undefined,
          ),
        })
      : t("s.reservations.manage.id.confirmNoShow");

    if (!window.confirm(message)) {
      return;
    }

    setMarkingNoShow(true);
    setActionError("");

    try {
      setReservation(await markReservationNoShow(reservation.id));
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t("s.reservations.manage.id.failedNoShow"),
      );
    } finally {
      setMarkingNoShow(false);
    }
  }

  // The staff actions on a payment request: each returns the booking as it now is.
  async function runPaymentAction(key: AdvanceAction | "reopen", action: () => Promise<Reservation>) {
    setPaymentAction(key);
    setActionError("");

    try {
      setReservation(await action());
      setPaymentLink("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("s.reservations.manage.id.failedPaymentAction"));
    } finally {
      setPaymentAction(null);
    }
  }

  async function showPaymentLink() {
    if (!reservation) return;

    setPaymentAction("link");
    setActionError("");

    try {
      setPaymentLink(await getPaymentLink(reservation.id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("s.reservations.manage.id.failedPaymentAction"));
    } finally {
      setPaymentAction(null);
    }
  }

  function handleAdvanceAction(action: AdvanceAction) {
    if (!reservation) return;

    if (action === "link") return void showPaymentLink();

    if (action === "resend") return void runPaymentAction(action, () => resendPaymentRequest(reservation.id));

    if (action === "extend") return void runPaymentAction(action, () => extendPaymentWindow(reservation.id, 24));

    // Recording money received confirms the booking and issues an invoice: ask first.
    const method = action === "cash" ? "CASH" : "TRANSFER";
    const confirmed = window.confirm(
      t("s.reservations.manage.id.confirmAdvanceReceived", {
        amount: formatCurrency(reservation.advance_amount ?? 0),
        method: t(action === "cash" ? "s.reservations.manage.id.methodCash" : "s.reservations.manage.id.methodTransfer"),
      }),
    );

    if (confirmed) void runPaymentAction(action, () => recordAdvanceReceived(reservation.id, method));
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <SkeletonDetailPage />
      </main>
    );
  }

  if (error || !reservation) {
    return (
      <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-danger">
            {error || t("s.reservations.manage.id.reservationNotFound")}
          </p>
        </div>
      </main>
    );
  }

  // The price can be changed until money has been taken or is on its way.
  const priceCanChange =
    ["PENDING", "AWAITING_PAYMENT", "CONFIRMED"].includes(reservation.status) &&
    !(reservation.prepayment && ["PENDING", "PROCESSING", "SUCCEEDED"].includes(reservation.prepayment.payment_status));

  // The advance has been received (online, or recorded by hand) and still stands.
  const advancePaid =
    reservation.prepayment?.payment_status === "SUCCEEDED" && !["CANCELLED", "EXPIRED"].includes(reservation.status);

  const rentalDays = getRentalDays(
    reservation.pickup_at,
    reservation.return_at
  );

  return (
    <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">

        {/* Header: who and what at a glance, the figures, and the one edit button */}
        <div className="mb-5">

          <button
            onClick={() =>
              navigate("/reservations/manage")
            }
            className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />{t("s.reservations.manage.id.backReservations")}</button>

          <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-ink">{t("s.reservations.manage.id.reservation")}</h1>

                <ReservationStatusBadge status={reservation.status} />

                {advancePaid && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
                    <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("s.reservations.manage.id.advancePaid")}
                  </span>
                )}
              </div>

              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
                <span>
                  {t("s.reservations.manage.id.booking")}{" "}
                  <span className="font-mono text-ink-secondary">
                    {reservation.public_reference ?? bookingReference(reservation.id)}
                  </span>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t("s.reservations.manage.id.booked")} {formatDate(reservation.created_at)} {formatTime(reservation.created_at)}
                </span>
              </p>
            </div>

            <div className="flex items-start gap-5">
              <div className="text-left md:text-right">
                <p className="text-xs text-ink-muted">{t("s.reservations.manage.id.rentalDuration")}</p>

                <p className="text-xl font-semibold">
                  {t("duration.days", { count: rentalDays })}
                </p>
              </div>

              {reservation.agreed_total_amount !== null && (
                <div className="text-left md:text-right">
                  <p className="text-xs text-ink-muted">{t("s.reservations.manage.id.totalPrice")}</p>

                  <p className="text-xl font-semibold tabular-nums">
                    {formatCurrency(reservation.agreed_total_amount)}
                  </p>

                  {reservation.price_adjustment_amount && (
                    <p className="mt-0.5 max-w-52 text-xs text-ink-muted">
                      {t("s.reservations.manage.id.adjustmentNote", {
                        amount: formatCurrency(reservation.price_adjustment_amount),
                        reason: reservation.price_adjustment_reason ?? "",
                      })}
                    </p>
                  )}

                  {canWrite && priceCanChange && (
                    <button
                      type="button"
                      onClick={() => setAdjustingPrice(true)}
                      className="text-xs font-medium text-accent-ink underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                    >
                      {t("s.reservations.manage.id.adjustPrice")}
                    </button>
                  )}
                </div>
              )}

              {EDITABLE_STATUSES.has(reservation.status) && (
                <Button variant="secondary" onClick={() => setEditing(true)} disabled={!canWrite}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  {t("s.reservations.manage.id.edit")}
                </Button>
              )}
            </div>

          </div>
        </div>

        {/* Main grid: the facts on the left; on the right the actions come first, so what
            to do about this booking is on screen without scrolling. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">

          {/* Left: the facts. On a phone the columns stack and the actions come first. */}
          <div className="order-2 space-y-4 lg:order-1">

            <div className="grid gap-4 sm:grid-cols-2">
              <ReservationCustomerCard
                reservation={reservation}
                onOpenCustomer={() => navigate(`/customers/${reservation.customer.id}`)}
              />

              <ReservationVehicleCard
                reservation={reservation}
                canWrite={canWrite}
                onOpenVehicle={() => navigate(`/cars/${reservation.car.id}`)}
                onConfirmCar={async () => {
                  try {
                    setReservation(await confirmReservationCar(reservation.id));
                  } catch {
                    /* the card stays as it was; the next action shows any real problem */
                  }
                }}
              />
            </div>

            {/* Rental timeline, with the extras beside it when there are any */}
            <div className="grid items-start gap-4 sm:grid-cols-2">
              {/* Rental timeline */}
              <section
                className={`rounded-2xl border border-border-subtle bg-surface p-6 ${
                  reservation.extras.length > 0 ? "" : "sm:col-span-2"
                }`}
              >

                <h2 className="text-lg font-semibold">{t("s.reservations.manage.id.rentalTimeline")}</h2>

                <div className="mt-6">

                  {/* Pickup */}
                  <div className="flex gap-4">

                    <div className="flex flex-col items-center">

                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-on-accent">
                        <Check className="h-4 w-4" />
                      </div>

                      <div className="mt-2 h-16 w-px bg-border-subtle" />

                    </div>

                    <div className="pb-6">

                      <p className="text-sm font-medium text-ink-muted">{t("s.reservations.manage.id.pickup")}</p>

                      <p className="mt-1 text-lg font-semibold">
                        {reservation.pickup_location.name}
                      </p>

                      <p className="mt-1 text-sm text-ink-secondary">
                        {formatDateTime(
                          reservation.pickup_at, reservation.pickup_location.timezone
                        )}
                      </p>

                      <span className="mt-2 inline-block rounded-md bg-surface-sunken px-2 py-1 text-xs font-medium">
                        {
                          reservation.pickup_location
                            .airport_code
                        }
                      </span>

                    </div>

                  </div>

                  {/* Return */}
                  <div className="flex gap-4">

                    <div className="flex flex-col items-center">

                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken text-ink-secondary">
                        <Undo2 className="h-4 w-4" />
                      </div>

                    </div>

                    <div>

                      <p className="text-sm font-medium text-ink-muted">{t("s.reservations.manage.id.return")}</p>

                      <p className="mt-1 text-lg font-semibold">
                        {reservation.return_location.name}
                      </p>

                      <p className="mt-1 text-sm text-ink-secondary">
                        {formatDateTime(
                          reservation.return_at, reservation.return_location.timezone
                        )}
                      </p>

                      <span className="mt-2 inline-block rounded-md bg-surface-sunken px-2 py-1 text-xs font-medium">
                        {
                          reservation.return_location
                            .airport_code
                        }
                      </span>

                    </div>

                  </div>

                </div>
              </section>

              {reservation.extras.length > 0 && <ReservationExtrasCard reservation={reservation} rentalDays={rentalDays} />}
            </div>

          </div>

          {/* Right rail: the actions first, then what bears on the decision and the paperwork */}
          <div className="order-1 space-y-4 lg:order-2">

            {/* Actions */}
            <section className="rounded-2xl border border-border-subtle bg-surface p-5">

              <h2 className="text-lg font-semibold">{t("s.reservations.manage.id.actions")}</h2>

              {actionError && (
                <div className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">
                  {actionError}
                </div>
              )}

              {/* PENDING */}
              {reservation.status === "PENDING" && (
                <div className="mt-5 space-y-3">

                  <button
                    onClick={() => setApproving(true)}
                    disabled={!canWrite || updatingStatus || cancelling}
                    className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-on-accent transition hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingStatus
                      ? t("s.reservations.manage.id.approving")
                      : t("s.reservations.manage.id.approveReservation2")}
                  </button>

                  <button
                    onClick={handleCancelReservation}
                    disabled={!canWrite || updatingStatus || cancelling}
                    className="w-full rounded-lg border-2 border-ink px-4 py-3 font-medium text-ink hover:bg-ink hover:text-surface disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancelling
                      ? t("s.reservations.manage.id.rejecting")
                      : t("s.reservations.manage.id.rejectReservation")}
                  </button>

                  <p className="pt-1 text-xs text-ink-muted">{t("s.reservations.manage.id.approvingWillLetReservation")}</p>

                </div>
              )}

              {/* AWAITING_PAYMENT: an online booking still being paid for */}
              {reservation.status === "AWAITING_PAYMENT" && (
                <div className="mt-5 space-y-3">
                  {reservation.advance_amount !== null ? (
                    <AdvancePaymentPanel
                      amount={reservation.advance_amount}
                      deadline={reservation.hold_expires_at}
                      timeZone={reservation.pickup_location.timezone}
                      canWrite={canWrite}
                      busy={paymentAction === "reopen" ? null : paymentAction}
                      link={paymentLink}
                      onAction={handleAdvanceAction}
                    />
                  ) : (
                    <div className="rounded-lg bg-surface-sunken p-4">
                      <p className="font-medium text-ink-secondary">{t("s.reservations.manage.id.waitingForPayment")}</p>

                      <p className="mt-1 text-sm text-ink-muted">{t("s.reservations.manage.id.waitingForPaymentBody")}</p>
                    </div>
                  )}

                  <button
                    onClick={handleCancelReservation}
                    disabled={!canWrite || updatingStatus || cancelling}
                    className="w-full rounded-lg border-2 border-ink px-4 py-3 font-medium text-ink hover:bg-ink hover:text-surface disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancelling
                      ? t("s.reservations.manage.id.cancelling")
                      : t("s.reservations.manage.id.cancelReservation")}
                  </button>
                </div>
              )}

              {/* EXPIRED: the payment never came */}
              {reservation.status === "EXPIRED" && (
                <div className="mt-4 rounded-lg bg-surface-sunken p-4">
                  <p className="font-medium text-ink-secondary">{t("s.reservations.manage.id.holdExpired")}</p>

                  <p className="mt-1 text-sm text-ink-muted">{t("s.reservations.manage.id.holdExpiredBody")}</p>

                  {reservation.advance_amount !== null && canWrite && (
                    <Button
                      className="mt-3"
                      variant="secondary"
                      size="sm"
                      disabled={paymentBusy}
                      loading={paymentAction === "reopen"}
                      onClick={() => void runPaymentAction("reopen", () => extendPaymentWindow(reservation.id, 24))}
                    >
                      {t("s.reservations.manage.id.reopenWindow")}
                    </Button>
                  )}
                </div>
              )}

              {/* CONFIRMED */}
              {reservation.status === "CONFIRMED" && (
                <div className="mt-5 space-y-3">

                  <button
                    onClick={() =>
                      navigate(`/handovers/${reservation.id}/check-in`)
                    }
                    disabled={!canWrite}
                    className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-on-accent transition hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2"
                  >{t("s.reservations.manage.id.startCheckPaymentAgreement")}</button>

                  <button
                    onClick={handleCancelReservation}
                    disabled={!canWrite || updatingStatus || cancelling}
                    className="w-full rounded-lg border-2 border-ink px-4 py-3 font-medium text-ink hover:bg-ink hover:text-surface disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancelling
                      ? t("s.reservations.manage.id.cancelling")
                      : t("s.reservations.manage.id.cancelReservation")}
                  </button>

                  {new Date(reservation.pickup_at) <= new Date() && (
                    <button
                      onClick={handleNoShow}
                      disabled={!canWrite || updatingStatus || cancelling || markingNoShow}
                      className="w-full rounded-lg border border-border-strong px-4 py-3 font-medium text-ink-secondary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {markingNoShow
                        ? t("s.reservations.manage.id.markingNoShow")
                        : t("s.reservations.manage.id.markNoShow")}
                    </button>
                  )}

                  <p className="pt-1 text-xs text-ink-muted">{t("s.reservations.manage.id.checkCollectsPaymentSignatures")}</p>

                </div>
              )}

              {/* ACTIVE */}
              {reservation.status === "ACTIVE" && (
                <div className="mt-5">

                  <div className="rounded-lg bg-accent-soft p-4">
                    <p className="font-semibold text-accent-ink">{t("s.reservations.manage.id.rentalCurrentlyActive")}</p>

                    <p className="mt-1 text-sm text-ink-secondary">{t("s.reservations.manage.id.vehicleCurrentlyWithCustomer")}</p>
                  </div>

                  <button
                    onClick={() =>
                      navigate(`/handovers/${reservation.id}/check-out`)
                    }
                    disabled={!canWrite}
                    className="mt-4 w-full rounded-lg bg-accent px-4 py-3 font-medium text-on-accent transition hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2"
                  >{t("s.reservations.manage.id.startCheckOut")}</button>

                  {handover?.has_agreement && (
                    <button
                      onClick={() =>
                        downloadAgreement(
                          reservation.id,
                          `agreement-${reservation.id}.pdf`,
                        )
                      }
                      className="mt-3 block w-full rounded-lg border border-border-strong px-4 py-3 text-center font-medium text-ink-secondary hover:bg-canvas"
                    >{t("s.reservations.manage.id.downloadAgreement")}</button>
                  )}

                </div>
              )}

              {/* CANCELLED */}
              {reservation.status === "CANCELLED" && (
                <div className="mt-4 rounded-lg bg-surface-sunken p-4">
                  <p className="font-medium text-ink-secondary">{t("s.reservations.manage.id.reservationCancelled")}</p>

                  <p className="mt-1 text-sm text-ink-muted">{t("s.reservations.manage.id.reservationNoLongerActive")}</p>

                  {handover?.payment_status === "REFUNDED" && (
                    <p className="mt-2 text-sm text-ink-secondary">{t("s.reservations.manage.id.refundedVia", { amount: formatCurrency(handover.refund_amount ?? 0, handover.payment_currency ?? undefined), method: handover.payment_method ?? "" })}</p>
                  )}
                </div>
              )}

              {/* COMPLETED */}
              {reservation.status === "COMPLETED" && (
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg bg-canvas p-4">
                    <p className="font-medium text-ink">{t("s.reservations.manage.id.rentalCompleted")}</p>

                    <p className="mt-1 text-sm text-ink-secondary">{t("s.reservations.manage.id.rentalHasBeenCompleted")}</p>
                  </div>

                  {handover?.has_agreement && (
                    <button
                      onClick={() =>
                        downloadAgreement(
                          reservation.id,
                          `agreement-${reservation.id}.pdf`,
                        )
                      }
                      className="block w-full rounded-lg border border-border-strong px-4 py-3 text-center font-medium text-ink-secondary hover:bg-canvas"
                    >{t("s.reservations.manage.id.downloadAgreement")}</button>
                  )}
                </div>
              )}

              {/* Who approved the handover — a quiet line under the
                  actions; expands to show when and their signature. */}
              {handover?.has_agreement && handover.has_employee_signature && (
                <div className="mt-4 border-t border-border-subtle pt-3">
                  <button
                    type="button"
                    onClick={() => setShowApproval((open) => !open)}
                    aria-expanded={showApproval}
                    className="flex w-full items-center justify-between gap-2 text-left text-sm text-ink-secondary hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                  >
                    <span>{t("s.reservations.manage.id.approvedBy")}{" "}<span className="font-medium text-ink">
                        {handover.employee_signed_by_email ?? t("s.reservations.manage.id.formerEmployee")}
                      </span>
                    </span>

                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition ${
                        showApproval ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {showApproval && (
                    <div className="mt-3 space-y-3">
                      {handover.employee_signed_at && (
                        <p className="text-xs text-ink-muted">{t("s.reservations.manage.id.signed", { v1: formatDateTime(handover.employee_signed_at) })}</p>
                      )}

                      {handover.employee_signature_image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={handover.employee_signature_image}
                          alt={t("s.reservations.manage.id.employeeSignature")}
                          className="h-16 w-auto rounded-lg border border-border-subtle bg-surface p-2"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* The return: who received the car and what was recorded. */}
              {checkOut?.completed_at && (
                <div className="mt-4 border-t border-border-subtle pt-3">
                  <button
                    type="button"
                    onClick={() => setShowCheckOut((open) => !open)}
                    aria-expanded={showCheckOut}
                    className="flex w-full items-center justify-between gap-2 text-left text-sm text-ink-secondary hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
                  >
                    <span>{t("s.reservations.manage.id.returned")}{" "}<span className="font-medium text-ink">
                        {checkOut.employee_signed_by_email ?? t("s.reservations.manage.id.formerEmployee")}
                      </span>
                    </span>

                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition ${
                        showCheckOut ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {showCheckOut && (
                    <div className="mt-3 space-y-2 text-sm text-ink-secondary">
                      <p>{t("s.reservations.manage.id.returned2", { v1: formatDateTime(checkOut.returned_at) })}</p>
                      <p>{t("s.reservations.manage.id.kmFuel8", { v1: formatNumber(checkOut.return_mileage), fuel_eighths: checkOut.fuel_eighths })}</p>
                      <p>
                        {checkOut.damage_reported
                          ? checkOut.damage_notes ? t("s.reservations.manage.id.damage", { notes: checkOut.damage_notes }) : t("s.reservations.manage.id.damageReported")
                          : t("s.reservations.manage.id.noDamageReported")}
                      </p>
                      <p>
                        {checkOut.total_charge > 0
                          ? t("s.reservations.manage.id.charged", { amount: formatCurrency(
                              checkOut.total_charge,
                              checkOut.payment_currency?.toUpperCase(),
                            ), method: checkOut.payment_method ?? "" })
                          : t("s.reservations.manage.id.noReturnCharges")}
                        {checkOut.waiver_reason &&
                          ` — ${t("s.reservations.manage.id.waived", { reason: checkOut.waiver_reason })}`}
                      </p>

                      {checkOut.employee_signature_image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={checkOut.employee_signature_image}
                          alt={t("s.reservations.manage.id.employeeSignatureAtCheck")}
                          className="h-16 w-auto rounded-lg border border-border-subtle bg-surface p-2"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}


            </section>

            {reservation.status === "PENDING" && (
              <OverlappingReservationsCard reservationId={reservation.id} />
            )}

            <OnlineBookingCard reservation={reservation} />

            <InvoicesCard
              reservationId={reservation.id}
              refreshKey={handover?.payment_status ?? ""}
            />

          </div>
        </div>

      </div>

      {choosingRefund && (
        <CancelWithRefundModal
          reservation={reservation}
          onClose={() => setChoosingRefund(false)}
          onCancelled={(updated) => setReservation(updated)}
        />
      )}

      {approving && (
        <ApproveModal
          reservation={reservation}
          onClose={() => setApproving(false)}
          onApproved={(updated) => setReservation(updated)}
        />
      )}

      {adjustingPrice && (
        <PriceAdjustmentModal
          reservation={reservation}
          reasonRequired={!can(currentUser?.role, "money.approve")}
          onClose={() => setAdjustingPrice(false)}
          onSaved={(updated) => setReservation(updated)}
        />
      )}

      {editing && (
        <ReservationEditModal
          reservation={reservation}
          locations={locations}
          onClose={() => setEditing(false)}
          onSaved={(updated) => setReservation(updated)}
        />
      )}
    </main>
  );
}