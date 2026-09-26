"use client";

// What this browser tab remembers about the booking in progress. Session
// storage, so it is gone when the tab is: the tokens are short-lived anyway.

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the visitor can still look the booking up.
  }
}

export const manageToken = {
  get: (reference: string) => read(`manage-token:${reference}`),
  set: (reference: string, token: string) => write(`manage-token:${reference}`, token),
};

/** A booking that has been created and is waiting for its payment. */
export type PendingBooking = {
  reference: string;
  clientSecret: string;
  holdExpiresAt: string;
  currency: string;
  totalAmount: number;
  onlineAmount: number;
  dueAtPickup: number;
  /** A one-line description of what was booked, for the payment step. */
  summary: { vehicle: string; pickup: string; dropoff: string };
};

export const pendingBooking = {
  get(): PendingBooking | null {
    const raw = read("pending-booking");

    if (!raw) return null;

    try {
      const value = JSON.parse(raw) as PendingBooking;

      return new Date(value.holdExpiresAt).getTime() > Date.now() ? value : null;
    } catch {
      return null;
    }
  },
  set: (value: PendingBooking) => write("pending-booking", JSON.stringify(value)),
  clear: () => write("pending-booking", null),
};
