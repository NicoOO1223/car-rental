import { NextResponse, type NextRequest } from "next/server";

import { accountToken } from "@/lib/accountServer";
import { runtimeConfig } from "@/lib/runtime";

// The API calls this site makes for the emailed links. Only these, so the browser
// cannot reach any other account route through here.
const ACTIONS: Record<string, { path: string; needsSession: boolean }> = {
  verify: { path: "verify", needsSession: false },
  "resend-verification": { path: "resend-verification", needsSession: true },
  "forgot-password": { path: "forgot-password", needsSession: false },
  "reset-password": { path: "reset-password", needsSession: false },
};

export async function POST(request: NextRequest) {
  const { action, ...body } = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const target = typeof action === "string" ? ACTIONS[action] : undefined;

  if (!target) return NextResponse.json({ code: "unknown", detail: "Bad request" }, { status: 400 });

  const token = target.needsSession ? await accountToken() : null;

  if (target.needsSession && !token) {
    return NextResponse.json({ code: "account.signed_out", detail: "Not signed in" }, { status: 401 });
  }

  const forwarded = request.headers.get("x-forwarded-for");

  try {
    const upstream = await fetch(`${runtimeConfig().apiUrl}/api/public/account/${target.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(forwarded ? { "X-Forwarded-For": forwarded } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });

    return NextResponse.json(await upstream.json().catch(() => ({})), {
      status: upstream.status,
      headers: upstream.headers.has("Retry-After") ? { "Retry-After": upstream.headers.get("Retry-After")! } : {},
    });
  } catch {
    return NextResponse.json({ code: "network", detail: "Network error" }, { status: 502 });
  }
}
