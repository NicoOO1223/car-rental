import { NextResponse, type NextRequest } from "next/server";

import { ACCOUNT_COOKIE, accountToken } from "@/lib/accountServer";
import { runtimeConfig } from "@/lib/runtime";

const MODES = new Set(["login", "register"]);
const MAX_AGE_SECONDS = 14 * 24 * 3600;

/** Passes the visitor's address on, so the API rate-limits the visitor and not this server. */
function forwardedFor(request: NextRequest): Record<string, string> {
  const forwarded = request.headers.get("x-forwarded-for");

  return forwarded ? { "X-Forwarded-For": forwarded } : {};
}

/** Sign in or register. The API token goes into an httpOnly cookie; the browser only gets the profile. */
export async function POST(request: NextRequest) {
  const { mode, ...body } = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof mode !== "string" || !MODES.has(mode)) {
    return NextResponse.json({ code: "unknown", detail: "Bad request" }, { status: 400 });
  }

  let upstream: Response;

  try {
    upstream = await fetch(`${runtimeConfig().apiUrl}/api/public/account/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...forwardedFor(request) },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return NextResponse.json({ code: "network", detail: "Network error" }, { status: 502 });
  }

  const data = await upstream.json().catch(() => ({}));

  // Errors pass straight through, so the form can word them like any API failure.
  if (!upstream.ok) {
    return NextResponse.json(data, {
      status: upstream.status,
      headers: upstream.headers.has("Retry-After") ? { "Retry-After": upstream.headers.get("Retry-After")! } : {},
    });
  }

  const response = NextResponse.json({ account: data.account }, { status: upstream.status });

  response.cookies.set(ACCOUNT_COOKIE, data.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });

  return response;
}

/** Sign out: ends the session on the API (every device) and clears the cookie. */
export async function DELETE(request: NextRequest) {
  const token = await accountToken();

  if (token) {
    await fetch(`${runtimeConfig().apiUrl}/api/public/account/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...forwardedFor(request) },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(ACCOUNT_COOKIE);

  return response;
}
