"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import { VehicleArt } from "@/components/VehicleArt";
import { VehicleSpecs } from "@/components/VehicleSpecs";
import { api, carPhotoUrl, type Booking } from "@/lib/client";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { manageToken } from "@/lib/session";
import { vehicleName } from "@/lib/vehicleText";

const primary =
  "rounded-lg bg-accent px-5 py-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 disabled:opacity-50";
const secondary =
  "rounded-lg border border-border-strong bg-surface px-5 py-3 text-sm font-medium text-ink-secondary hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900";

/** One booking as its renter sees it, with the way to cancel it under the policy. */
export function BookingView({ language, reference }: { language: string; reference: string }) {
  const t = useTranslations("booking");
  const all = useTranslations();
  const justConfirmed = useSearchParams().get("confirmed") === "1";

  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [needsLookup, setNeedsLookup] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const token = manageToken.get(reference);

    if (!token) {
      setNeedsLookup(true);
      return;
    }

    api
      .booking(reference, token)
      .then(setBooking)
      .catch((failure) => {
        if (failure?.code === "public.manage_token_invalid") setNeedsLookup(true);
        else setError(errorMessage(all, failure));
      });
    // The translator changes only with the language, which reloads the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  async function handleCancel() {
    const token = manageToken.get(reference);

    if (!token) return setNeedsLookup(true);

    setCancelling(true);
    setError("");

    try {
      setBooking(await api.cancel(reference, token));
      setConfirming(false);
    } catch (failure) {
      setError(errorMessage(all, failure));
    } finally {
      setCancelling(false);
    }
  }

  if (needsLookup) {
    return (
      <div className="rounded-xl bg-surface p-6 shadow-sm">
        <p className="text-ink-secondary">{t("expiredSession")}</p>
        <Link href={`/${language}/manage?reference=${encodeURIComponent(reference)}`} className={`${primary} mt-4 inline-block`}>
          {t("lookup")}
        </Link>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <p className="rounded-xl bg-surface p-6 text-red-600 shadow-sm" role="alert">
        {error}
      </p>
    );
  }

  if (!booking) return <p className="text-ink-muted">{t("loading")}</p>;

  const money = (amount: number) => formatMoney(amount, booking.currency, language);
  const at = (iso: string, zone: string) =>
    t("dateAtTime", { date: formatDate(iso, zone, language), time: formatTime(iso, zone, language) });
  const deadline = booking.cancellation_deadline_at;
  const zone = booking.pickup_location.timezone;
  const statusKey = `status.${booking.status}`;

  return (
    <div className="space-y-6">
      {justConfirmed && booking.status === "CONFIRMED" && (
        <section className="rounded-xl bg-gray-900 p-6 text-white" role="status">
          <h1 className="text-xl font-bold">{t("confirmedTitle")}</h1>
          <p className="mt-2 text-gray-200">
            {booking.due_at_pickup > 0
              ? t("confirmedBody", { paid: money(booking.paid_online), rest: money(booking.due_at_pickup) })
              : t("confirmedFull", { paid: money(booking.paid_online) })}
          </p>
          <p className="mt-2 text-sm text-gray-300">{t("keepReference")}</p>
        </section>
      )}

      <section className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {!justConfirmed && <h1 className="text-xl font-bold">{t("title")}</h1>}
            <p className="text-sm text-ink-muted">{t("reference")}</p>
            <p className="font-mono text-2xl font-semibold tracking-wide">{booking.reference}</p>
          </div>

          <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium">
            {all.has(statusKey) ? all(statusKey) : booking.status}
          </span>
        </div>

        {booking.status === "AWAITING_PAYMENT" && booking.hold_expires_at && (
          <p className="mt-4 rounded-lg bg-surface-sunken p-3 text-sm text-ink-secondary">
            {t("waitingBody", { time: formatTime(booking.hold_expires_at, zone, language) })}
          </p>
        )}
        {booking.status === "EXPIRED" && <p className="mt-4 text-sm text-ink-secondary">{t("expiredNote")}</p>}
        {booking.status === "CANCELLED" && (
          <div className="mt-4 space-y-1 text-sm text-ink-secondary">
            <p>{t("cancelledNote")}</p>
            {booking.refunded_online > 0 && <p>{t("refundedNote", { amount: money(booking.refunded_online) })}</p>}
            {booking.refunded_online === 0 && booking.paid_online > 0 && <p>{t("keptNote", { amount: money(booking.paid_online) })}</p>}
          </div>
        )}
      </section>

      <section className="grid gap-5 rounded-xl bg-surface p-5 shadow-sm sm:grid-cols-[14rem_1fr] sm:p-6">
        <VehicleArt
          imageUrl={
            booking.vehicle.has_photo ? carPhotoUrl(booking.vehicle.offer_key, booking.vehicle.photo_version) : null
          }
          category={booking.vehicle.category}
          alt={vehicleName(booking.vehicle, language)}
          className="aspect-[16/9] w-full rounded-lg"
        />

        <div className="space-y-4 text-sm">
          <div>
            <p className="text-ink-muted">{t("car")}</p>
            <p className="font-semibold">{vehicleName(booking.vehicle, language)}</p>
            <div className="mt-2">
              <VehicleSpecs
                category={booking.vehicle.category}
                transmission={booking.vehicle.transmission}
                fuelType={booking.vehicle.fuel_type}
                seats={booking.vehicle.seats}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-ink-muted">{t("pickup")}</p>
              <p className="font-medium">
                {booking.pickup_location.name} ({booking.pickup_location.airport_code})
              </p>
              <p className="text-ink-secondary">{at(booking.pickup_at, booking.pickup_location.timezone)}</p>
              {booking.pickup_location.address && <p className="text-ink-muted">{booking.pickup_location.address}</p>}
            </div>

            <div>
              <p className="text-ink-muted">{t("return")}</p>
              <p className="font-medium">
                {booking.return_location.name} ({booking.return_location.airport_code})
              </p>
              <p className="text-ink-secondary">{at(booking.return_at, booking.return_location.timezone)}</p>
              {booking.return_location.address && <p className="text-ink-muted">{booking.return_location.address}</p>}
            </div>
          </div>

          {booking.extras.length > 0 && (
            <div>
              <p className="text-ink-muted">{t("extras")}</p>
              <ul>
                {booking.extras.map((extra) => (
                  <li key={extra.name}>
                    {extra.name}
                    {extra.quantity > 1 ? ` × ${extra.quantity}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">{t("payment")}</h2>

        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">{t("total")}</dt>
            <dd className="font-semibold tabular-nums">{money(booking.total_amount)}</dd>
          </div>
          {booking.paid_online > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-secondary">{t("paidOnline")}</dt>
              <dd className="tabular-nums">{money(booking.paid_online)}</dd>
            </div>
          )}
          {["AWAITING_PAYMENT", "CONFIRMED", "ACTIVE"].includes(booking.status) && (
            <div className="flex justify-between gap-3 border-t border-border-subtle pt-2">
              <dt className="font-medium">{t("dueAtPickup")}</dt>
              <dd className="font-semibold tabular-nums">{money(booking.due_at_pickup)}</dd>
            </div>
          )}
        </dl>
      </section>

      {(booking.can_cancel || booking.status === "CONFIRMED") && (
        <section className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
          {deadline && booking.paid_online > 0 && (
            <p className="text-sm text-ink-secondary">
              {booking.cancel_refunds_online
                ? t("policyRefund", { date: formatDate(deadline, zone, language), time: formatTime(deadline, zone, language) })
                : t("policyKept", {
                    date: formatDate(deadline, zone, language),
                    time: formatTime(deadline, zone, language),
                    amount: money(booking.paid_online),
                  })}
            </p>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          {booking.can_cancel ? (
            confirming ? (
              <div className="mt-4 rounded-lg border border-border-strong p-4">
                <p className="font-semibold">{t("cancelTitle")}</p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {booking.paid_online === 0
                    ? t("cancelNothing")
                    : booking.cancel_refunds_online
                      ? t("cancelRefund", { amount: money(booking.paid_online) })
                      : t("cancelKept", { amount: money(booking.paid_online) })}
                </p>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={handleCancel} disabled={cancelling} className={primary}>
                    {cancelling ? t("cancelling") : t("cancelConfirm")}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} disabled={cancelling} className={secondary}>
                    {t("keep")}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className={`${secondary} mt-4`}>
                {t("cancel")}
              </button>
            )
          ) : (
            <p className="mt-3 text-sm text-ink-secondary">{t("cannotCancel")}</p>
          )}
        </section>
      )}
    </div>
  );
}
