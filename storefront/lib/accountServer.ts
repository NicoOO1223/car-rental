import "server-only";

import { cookies } from "next/headers";

import type { Booking } from "@/lib/client";
import { runtimeConfig } from "@/lib/runtime";

/** The renter's session lives in an httpOnly cookie set by /api/account/session,
 * so page scripts never see the token. */
export const ACCOUNT_COOKIE = "storefront_account";

export type Account = { email: string; first_name: string; last_name: string };

async function accountToken(): Promise<string | null> {
  return (await cookies()).get(ACCOUNT_COOKIE)?.value ?? null;
}

async function authorised<T>(path: string): Promise<T | null> {
  const token = await accountToken();

  if (!token) return null;

  try {
    const response = await fetch(`${runtimeConfig().apiUrl}/api/public/account${path}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The signed-in renter, or null for a guest (or an expired session). */
export const getAccount = () => authorised<Account>("/me");

export const getAccountBookings = () => authorised<Booking[]>("/bookings");

export { accountToken };
