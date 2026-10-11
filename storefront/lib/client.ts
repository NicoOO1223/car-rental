"use client";

import type { StorefrontRuntimeConfig } from "@shared/runtimeConfig";
import type { ApiError, PublicLocation, PublicOffer, PublicVehicle } from "@shared/publicApi";

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: StorefrontRuntimeConfig;
  }
}

/** This stack settings, as the layout handed them to the browser. */
export function browserConfig(): StorefrontRuntimeConfig {
  return (
    window.__RUNTIME_CONFIG__ ?? {
      apiUrl: "http://127.0.0.1:8000",
      stripePublishableKey: "",
      turnstileSiteKey: "",
      sentryDsn: "",
      storefrontUrl: "",
    }
  );
}

/** A representative photo for this offer — see lib/runtime.ts's own
 * carPhotoUrl for why this is keyed by offer_key, not a car id. This is
 * the client-component version, reading the config the layout already
 * handed the browser rather than process.env (unavailable here). */
export function carPhotoUrl(offerKey: string, version: number | null): string {
  return `${browserConfig().apiUrl}/api/public/offers/${offerKey}/photo${version ? `?v=${version}` : ""}`;
}

/** An error the API answered with: a stable code and the values for wording it. */
export class ApiFailure extends Error {
  code: string;
  params: ApiError["params"];
  status: number;

  constructor(status: number, body: Partial<ApiError>) {
    super(body.detail || "Request failed");
    this.status = status;
    this.code = body.code || "unknown";
    this.params = body.params || {};
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);

  headers.set("Accept", "application/json");
  if (rest.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;

  try {
    response = await fetch(`${browserConfig().apiUrl}/api/public${path}`, { ...rest, headers });
  } catch {
    throw new ApiFailure(0, { code: "network", detail: "Network error" });
  }

  if (!response.ok) {
    let body: Partial<ApiError> = {};

    try {
      body = await response.json();
    } catch {
      // Not JSON: the status alone will do.
    }

    throw new ApiFailure(response.status, body);
  }

  return response.json();
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export type Availability = { pickup_at: string; return_at: string; rental_days: number; offers: PublicOffer[] };

export type QuoteExtraLine = { code: string; name: string; quantity: number; unit_price: number; price_unit: string; amount: number };

export type Quote = {
  rental_days: number;
  currency: string;
  base_amount: number;
  short_term_fee: number;
  airport_change_fee: number;
  extras: QuoteExtraLine[];
  extras_amount: number;
  vat_rate: number;
  vat_amount: number;
  net_amount: number;
  prices_include_vat: boolean;
  total_amount: number;
  online_amount: number;
  due_at_pickup: number;
  online_share_percent: number;
  free_cancellation_hours: number;
  cancellation_deadline_at: string;
};

export type PublicExtra = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  translations: Record<string, Record<string, string | null>>;
  price: number;
  price_unit: "PER_DAY" | "PER_RENTAL";
  max_quantity: number;
};

export type BookingCreated = {
  reference: string;
  status: string;
  currency: string;
  total_amount: number;
  online_amount: number;
  due_at_pickup: number;
  /** Null for a request staff have yet to approve: nothing is paid or held. */
  client_secret: string | null;
  hold_expires_at: string | null;
  requires_payment: boolean;
  manage_token: string;
};

export type BookingStatus = {
  reference: string;
  status: string;
  hold_expires_at: string | null;
  payment_status: string | null;
};

export type Booking = {
  reference: string;
  status: string;
  pickup_at: string;
  return_at: string;
  pickup_location: PublicLocation;
  return_location: PublicLocation;
  vehicle: PublicVehicle;
  extras: { name: string; quantity: number }[];
  currency: string;
  total_amount: number;
  paid_online: number;
  refunded_online: number;
  due_at_pickup: number;
  hold_expires_at: string | null;
  cancellation_deadline_at: string | null;
  can_cancel: boolean;
  cancel_refunds_online: boolean;
  /** An approved booking waiting for its advance: how much, and whether it can be paid now. */
  advance_amount: number | null;
  payment_open: boolean;
  /** False for a booking staff made: the renter accepts the terms when paying. */
  terms_accepted: boolean;
};

export type BookingRequest = {
  offer_key: string;
  pickup_location_id: string;
  return_location_id: string;
  pickup_at: string;
  return_at: string;
  extras: { extra_id: string; quantity: number }[];
  customer: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    address: string;
    postal_code: string;
    phone_number: string;
    email: string;
    nationality?: string | null;
  };
  expected_total: number;
  terms_accepted: boolean;
  privacy_acknowledged: boolean;
  /** The language the booking emails are written in. */
  language?: string;
  captcha_token: string;
};

export const api = {
  locations: () => call<PublicLocation[]>("/locations"),
  extras: () => call<PublicExtra[]>("/extras"),

  availability: (query: { pickup_location_id: string; return_location_id: string; pickup_at: string; return_at: string }) =>
    call<Availability>(`/availability?${new URLSearchParams(query)}`),

  quote: (body: {
    offer_key: string;
    pickup_location_id: string;
    return_location_id: string;
    pickup_at: string;
    return_at: string;
    extras: { extra_id: string; quantity: number }[];
  }) => call<Quote>("/quote", post(body)),

  createBooking: (body: BookingRequest) => call<BookingCreated>("/bookings", post(body)),

  syncPayment: (reference: string, token: string) =>
    call<BookingStatus>(`/bookings/${encodeURIComponent(reference)}/sync-payment`, { method: "POST", token }),

  lookup: (body: { reference: string; email: string; captcha_token: string }) =>
    call<{ manage_token: string; booking: Booking }>("/bookings/lookup", post(body)),

  startPayment: (reference: string, token: string, body: { terms_accepted: boolean; privacy_acknowledged: boolean }) =>
    call<{ client_secret: string; amount: number; currency: string }>(
      `/bookings/${encodeURIComponent(reference)}/payment`,
      { ...post(body), token },
    ),

  booking: (reference: string, token: string) => call<Booking>(`/bookings/${encodeURIComponent(reference)}`, { token }),

  cancel: (reference: string, token: string) =>
    call<Booking>(`/bookings/${encodeURIComponent(reference)}/cancel`, { method: "POST", token }),
};
