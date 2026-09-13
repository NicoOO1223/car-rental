"use client";

import { Check } from "lucide-react";

export type BookingStep = "search" | "vehicle" | "extras" | "customer" | "review";

export const BOOKING_STEPS: { id: BookingStep; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "vehicle", label: "Vehicle" },
  { id: "extras", label: "Extras" },
  { id: "customer", label: "Details" },
  { id: "review", label: "Review" },
];

export function stepIndex(step: BookingStep): number {
  return BOOKING_STEPS.findIndex((item) => item.id === step);
}

/**
 * Progress across the booking. Completed steps are clickable so a
 * customer can go back and change an earlier answer; steps ahead of the
 * furthest one reached are not, since their inputs do not exist yet.
 */
export function Stepper({
  current,
  furthest,
  onStepClick,
}: {
  current: BookingStep;
  /** The furthest step reached so far, which bounds what is navigable. */
  furthest: BookingStep;
  onStepClick: (step: BookingStep) => void;
}) {
  const currentIndex = stepIndex(current);
  const furthestIndex = stepIndex(furthest);

  return (
    <nav aria-label="Booking progress" className="mb-8">
      <ol className="flex items-center gap-1 sm:gap-2">
        {BOOKING_STEPS.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isReachable = index <= furthestIndex;

          return (
            <li key={step.id} className="flex flex-1 items-center gap-1 sm:gap-2">
              <button
                type="button"
                disabled={!isReachable || isCurrent}
                onClick={() => onStepClick(step.id)}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
                  isReachable && !isCurrent
                    ? "cursor-pointer hover:bg-surface-sunken"
                    : "cursor-default"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                    isComplete
                      ? "bg-gray-900 text-white"
                      : isCurrent
                        ? "bg-gray-900 text-white ring-4 ring-gray-900/10"
                        : "bg-surface-sunken text-ink-muted"
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>

                <span
                  className={`hidden truncate text-sm sm:inline ${
                    isCurrent
                      ? "font-semibold text-ink"
                      : isComplete
                        ? "font-medium text-ink-secondary"
                        : "text-ink-muted"
                  }`}
                >
                  {step.label}
                </span>
              </button>

              {index < BOOKING_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`h-0.5 min-w-2 flex-1 rounded-full transition ${
                    index < currentIndex ? "bg-gray-900" : "bg-border-subtle"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
