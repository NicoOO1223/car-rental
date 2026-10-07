"use client";

import { AlertTriangle, CalendarDays, MapPin } from "lucide-react";

import { PriceBreakdownList } from "@/components/pricing/PriceBreakdownList";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/format";
import type { Car, Location, ReservationQuote } from "@/lib/api";
import { t } from "@/lib/i18n";

/**
 * The running summary that stays beside the wizard from the vehicle step
 * onward. Every amount in it comes from the server's quote — nothing here
 * recomputes a price.
 */
export function BookingSummary({
  pickupLocation,
  returnLocation,
  pickupAt,
  returnAt,
  car,
  quote,
  quoting,
  quoteError,
}: {
  pickupLocation: Location | null;
  returnLocation: Location | null;
  pickupAt: string;
  returnAt: string;
  car: Car | null;
  quote: ReservationQuote | null;
  quoting: boolean;
  quoteError: string;
}) {
  const oneWay =
    pickupLocation && returnLocation && pickupLocation.id !== returnLocation.id;

  return (
    <aside
      aria-label={t("c.booking.BookingSummary.bookingSummary")}
      className="rounded-2xl border border-border-subtle bg-surface p-5 lg:sticky lg:top-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">{t("c.booking.BookingSummary.booking")}</h2>

      <div className="mt-4 space-y-3 text-sm">
        {pickupLocation && (
          <div className="flex gap-2.5">
            <MapPin
              className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-medium text-ink">
                {pickupLocation.airport_code}
                {oneWay && returnLocation && (
                  <span className="text-ink-muted">
                    {" → "}
                    {returnLocation.airport_code}
                  </span>
                )}
              </p>
              <p className="text-xs text-ink-muted">{pickupLocation.name}</p>
            </div>
          </div>
        )}

        {pickupAt && returnAt && (
          <div className="flex gap-2.5">
            <CalendarDays
              className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted"
              aria-hidden="true"
            />
            <div className="min-w-0 text-xs">
              <p className="font-medium text-ink">{formatDateTime(pickupAt, pickupLocation?.timezone)}</p>
              <p className="mt-0.5 text-ink-muted">{t("c.booking.BookingSummary.text", { v1: formatDateTime(returnAt, (returnLocation ?? pickupLocation)?.timezone) })}</p>
            </div>
          </div>
        )}
      </div>

      {car && (
        <div className="mt-4 border-t border-border-subtle pt-4">
          <p className="font-medium text-ink">
            {car.make} {car.model}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{car.license_plate}</p>
        </div>
      )}

      {car && (
        <div className="mt-4 border-t border-border-subtle pt-4">
          {quoteError ? (
            <p className="text-sm text-danger" role="alert">
              {quoteError}
            </p>
          ) : quoting && !quote ? (
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-4 h-6 w-1/2" />
            </div>
          ) : quote ? (
            <div className={quoting ? "opacity-60 transition-opacity" : ""}>
              <PriceBreakdownList breakdown={quote} />
            </div>
          ) : null}
        </div>
      )}

      {quote && !quote.car_available && quote.availability_message && (
        <div
          role="alert"
          className="mt-4 flex gap-2.5 rounded-lg bg-surface-sunken p-3 text-xs text-ink-secondary"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted"
            aria-hidden="true"
          />
          <p>{t("c.booking.BookingSummary.pickAnotherVehicleChange", { availability_message: quote.availability_message })}</p>
        </div>
      )}
    </aside>
  );
}
