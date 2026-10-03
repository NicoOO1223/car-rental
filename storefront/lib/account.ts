"use client";

import { ApiFailure } from "@/lib/client";
import type { ApiError } from "@shared/publicApi";

// The browser talks to this site's own /api/account routes, not to the API
// directly: the session token is kept in an httpOnly cookie there.

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
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

  return response.status === 204 ? (undefined as T) : response.json();
}

export type AccountProfile = { email: string; first_name: string; last_name: string };

export type Credentials = { email: string; password: string; captcha_token: string };

export type Registration = Credentials & { first_name: string; last_name: string };

export const accountApi = {
  login: (values: Credentials) =>
    request<{ account: AccountProfile }>("/api/account/session", { method: "POST", body: JSON.stringify({ mode: "login", ...values }) }),

  register: (values: Registration) =>
    request<{ account: AccountProfile }>("/api/account/session", { method: "POST", body: JSON.stringify({ mode: "register", ...values }) }),

  logout: () => request<void>("/api/account/session", { method: "DELETE" }),

  /** A short-lived token to open one of the account's own bookings. */
  access: (reference: string) =>
    request<{ manage_token: string }>("/api/account/access", { method: "POST", body: JSON.stringify({ reference }) }),

  /** Adds a booking to the signed-in account. Only the reference and booker's email prove it is theirs. */
  claim: (values: { reference: string; email: string }) =>
    request<unknown>("/api/account/claim", { method: "POST", body: JSON.stringify(values) }),
};
