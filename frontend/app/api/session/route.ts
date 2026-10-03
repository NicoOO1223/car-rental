import { NextResponse, type NextRequest } from "next/server";

import {
  LOGIN_RETRY_AFTER_SECONDS,
  isBlocked,
  recordFailure,
} from "@/lib/loginBudget";
import {
  apiBase,
  isSameOriginRequest,
  sessionCookieName,
  sessionMaxAge,
  visitorHeaders,
  visitorIp,
} from "@/lib/sessionServer";

const cookieOptions = () => ({
  httpOnly: true,
  // Lax, not Strict: following a link to this app from an email or chat should
  // find the person still signed in. Requests that change something are held to
  // same-origin separately (see isSameOriginRequest).
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
});

function failure(status: number, code: string, detail: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ detail, code, params: {} }, { status, headers });
}

/** Sign in. The API token goes into an httpOnly cookie; the browser gets nothing but "ok". */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return failure(403, "http.403", "Forbidden");
  }

  const visitor = visitorIp(request);

  if (isBlocked(visitor)) {
    return failure(429, "auth.too_many_attempts", "Too many login attempts. Try again later.", {
      "Retry-After": String(LOGIN_RETRY_AFTER_SECONDS),
    });
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
    return failure(400, "http.400", "Bad request");
  }

  let upstream: Response;

  try {
    upstream = await fetch(`${apiBase()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...visitorHeaders(request) },
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return failure(502, "http.503", "The service is not available right now.");
  }

  const data = await upstream.json().catch(() => ({}));

  // Errors pass straight through, so the form words them like any API failure.
  if (!upstream.ok || typeof data.access_token !== "string") {
    if (upstream.status === 401 || upstream.status === 429) recordFailure(visitor);

    const retryAfter = upstream.headers.get("Retry-After");

    return NextResponse.json(data, {
      status: upstream.ok ? 502 : upstream.status,
      headers: retryAfter ? { "Retry-After": retryAfter } : {},
    });
  }

  const response = NextResponse.json({ ok: true });

  response.cookies.set(sessionCookieName(), data.access_token, {
    ...cookieOptions(),
    maxAge: sessionMaxAge(data.access_token),
  });

  return response;
}

/** Sign out: ends the person's sessions on the API (every device) and clears the cookie. */
export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return failure(403, "http.403", "Forbidden");
  }

  const token = request.cookies.get(sessionCookieName())?.value;

  if (token) {
    await fetch(`${apiBase()}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...visitorHeaders(request) },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(sessionCookieName(), "", { ...cookieOptions(), maxAge: 0 });

  return response;
}
