import { NextResponse, type NextRequest } from "next/server";

import { accountToken } from "@/lib/accountServer";
import { runtimeConfig } from "@/lib/runtime";

/** A short-lived token to open one of the signed-in renter's own bookings, with no email asked. */
export async function POST(request: NextRequest) {
  const token = await accountToken();

  if (!token) return NextResponse.json({ code: "account.signed_out", detail: "Not signed in" }, { status: 401 });

  const { reference } = (await request.json().catch(() => ({}))) as { reference?: unknown };

  if (typeof reference !== "string" || !reference) {
    return NextResponse.json({ code: "unknown", detail: "Bad request" }, { status: 400 });
  }

  const forwarded = request.headers.get("x-forwarded-for");

  try {
    const upstream = await fetch(
      `${runtimeConfig().apiUrl}/api/public/account/bookings/${encodeURIComponent(reference)}/access`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...(forwarded ? { "X-Forwarded-For": forwarded } : {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );

    return NextResponse.json(await upstream.json().catch(() => ({})), { status: upstream.status });
  } catch {
    return NextResponse.json({ code: "network", detail: "Network error" }, { status: 502 });
  }
}
