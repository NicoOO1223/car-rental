"use client";

import { createElement } from "react";
import { Check as CheckIcon } from "lucide-react";

import { CarImage } from "@/components/cars/CarImage";
import { carSpecs } from "@/lib/carDisplay";
import { formatCurrency } from "@/lib/format";
import type { Car } from "@/lib/api";

/**
 * One bookable vehicle.
 *
 * The total for the whole rental is the prominent number, not the daily
 * rate, because that is the figure people actually compare between cars.
 * The daily rate stays visible underneath as the unit price. Both come
 * from the caller, which gets them from the server's quote rather than
 * computing them here.
 */
export function VehicleCard({
  car,
  totalAmount,
  rentalDays,
  selected,
  onSelect,
}: {
  car: Car;
  /** Total for the searched period, or null while it is being priced. */
  totalAmount: number | null;
  rentalDays: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const specs = carSpecs(car);
  const perDay = Number(car.price_per_day);

  return (
    <div
      className={`group flex flex-col overflow-hidden rounded-xl bg-surface shadow-sm transition ${
        selected
          ? "ring-2 ring-gray-900"
          : "ring-1 ring-transparent hover:shadow-md hover:ring-border-strong"
      }`}
    >
      <div className="relative">
        <CarImage
          imageUrl={car.image_url}
          category={car.category}
          alt={`${car.make} ${car.model}`}
          className="aspect-[16/9] w-full"
          captionSpace
        />

        {/* The model name sits over the photo, captioned the way rental
            listings always caption them: a booking is for a class of
            vehicle, so the exact car is "or similar", not a promise.
            A translucent light band rather than a dark one, because it
            keeps dark text legible over both a photo and the pale
            fallback silhouette. */}
        <div className="absolute inset-x-0 bottom-0 flex items-baseline justify-between gap-2 border-t border-black/5 bg-white/80 px-3 py-2 backdrop-blur-sm">
          <h3 className="min-w-0 truncate text-sm font-semibold text-ink">
            {car.make} {car.model}
            <span className="font-normal text-ink-muted"> or similar</span>
          </h3>

          <span className="shrink-0 text-xs text-ink-muted">{car.year}</span>
        </div>

        {selected && (
          <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-white shadow-sm">
            <CheckIcon className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Selected</span>
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        {specs.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {specs.map((spec) => (
              <li
                key={spec.label}
                className="inline-flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-xs text-ink-secondary"
              >
                {createElement(spec.icon, {
                  className: "h-3.5 w-3.5 shrink-0 text-ink-muted",
                  "aria-hidden": true,
                })}
                {spec.label}
              </li>
            ))}
          </ul>
        )}

        {/* Price above a full-width action rather than beside a cramped
            one: at three cards per row the inline layout wrapped the
            per-day line, and a wide button is an easier target. */}
        <div className="mt-5 border-t border-border-subtle pt-4">
          <div className="flex items-baseline justify-between gap-2">
            {totalAmount === null ? (
              <div className="h-7 w-24 animate-pulse rounded-md bg-gray-200" />
            ) : (
              <p className="text-xl font-bold tracking-tight text-ink tabular-nums">
                {formatCurrency(totalAmount)}
              </p>
            )}

            {rentalDays > 0 && (
              <p className="shrink-0 text-xs text-ink-muted">
                {rentalDays} day{rentalDays === 1 ? "" : "s"}
              </p>
            )}
          </div>

          <p className="mt-0.5 text-xs text-ink-muted">
            {formatCurrency(perDay)} per day
          </p>

          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={`mt-4 w-full rounded-lg px-4 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 ${
              selected
                ? "bg-surface-sunken text-ink"
                : "bg-gray-900 text-white hover:bg-gray-800"
            }`}
          >
            {selected ? "Selected" : "Select"}
          </button>
        </div>
      </div>
    </div>
  );
}
