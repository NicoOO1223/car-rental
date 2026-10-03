import { NextResponse, type NextRequest } from "next/server";

import { accountToken } from "@/lib/accountServer";
import { runtimeConfig } from "@/lib/runtime";

/** Adds a booking (reference + booker's email) to the signed-in renter's account. */
export async function POST(request: NextRequest) {
  const token = await accountToken();

  if (!token) return NextResponse.json({ code: "account.signed_out", detail: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const forwarded = request.headers.get("x-forwarded-for");

  try {
    const upstream = await fetch(`${runtimeConfig().apiUrl}/api/public/account/bookings/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(forwarded ? { "X-Forwarded-For": forwarded } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    return NextResponse.json(await upstream.json().catch(() => ({})), { status: upstream.status });
  } catch {
    return NextResponse.json({ code: "network", detail: "Network error" }, { status: 502 });
  }
}
