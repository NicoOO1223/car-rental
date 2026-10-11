"use client";

import { createPortal } from "react-dom";
import { Mail, Phone } from "lucide-react";

/** What the card shows, and the part of the booking bar that is on screen (viewport pixels). */
export type ScheduleHoverTarget = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  name: string;
  phone: string | null;
  email: string | null;
  when: string;
};

const WIDTH = 256;
const HEIGHT = 140; // what the card needs, near enough to choose between below and above
const GAP = 8;
const MARGIN = 8;

/**
 * A booking's contact details, shown over the schedule.
 *
 * It is drawn into the page body, outside the schedule's scrolling frame, so the
 * frame's sticky headers and columns can never paint over it and its edges can never
 * clip it. It sits below the bar and flips above it when there is no room, and stays
 * inside the window sideways. The caller owns the wording (this is a shared piece).
 */
export function ScheduleHoverCard({
  target,
  noPhone,
  noEmail,
}: {
  target: ScheduleHoverTarget;
  noPhone: string;
  noEmail: string;
}) {
  const centre = (target.left + target.right) / 2;
  const left = Math.min(Math.max(centre - WIDTH / 2, MARGIN), window.innerWidth - WIDTH - MARGIN);
  const below = target.bottom + GAP + HEIGHT <= window.innerHeight - MARGIN;

  const position = below
    ? { top: target.bottom + GAP }
    : { bottom: window.innerHeight - target.top + GAP };

  // The little pointer follows the bar even when the card had to slide to stay on screen.
  const pointer = Math.min(Math.max(centre - left, 16), WIDTH - 16);

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[70] flex flex-col gap-2 rounded-lg bg-deep px-3.5 py-3 text-xs text-on-deep shadow-lg"
      style={{ left, width: WIDTH, ...position }}
    >
      <p className="truncate text-sm font-semibold">{target.name}</p>

      <div className="space-y-1.5 border-t border-white/10 pt-2">
        <p className="flex items-center gap-2 text-border-strong">
          <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{target.phone || noPhone}</span>
        </p>

        <p className="flex items-center gap-2 text-border-strong">
          <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{target.email || noEmail}</span>
        </p>
      </div>

      <p className="border-t border-white/10 pt-2 text-ink-muted">{target.when}</p>

      <span
        className={`absolute h-2 w-2 -translate-x-1/2 rotate-45 bg-deep ${below ? "-top-1" : "-bottom-1"}`}
        style={{ left: pointer }}
        aria-hidden="true"
      />
    </div>,
    document.body,
  );
}
