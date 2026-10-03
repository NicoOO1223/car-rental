import { NextResponse, type NextRequest } from "next/server";

import {
  apiBase,
  isSameOriginRequest,
  sessionCookieName,
  visitorHeaders,
} from "@/lib/sessionServer";

/**
 * Every call the staff app makes to the API goes through here. The browser sends
 * its session cookie to this server; this server adds the token the cookie
 * holds and passes the call on, so the token itself never reaches a script.
 */

// What is passed on to the API, and what comes back. Anything else is dropped:
// in particular the browser's own cookies and credentials never travel on.
const REQUEST_HEADERS = ["content-type", "accept", "accept-language", "if-none-match", "if-modified-since", "range"];
const RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "cache-control",
  "etag",
  "last-modified",
  "retry-after",
  "content-range",
  "accept-ranges",
];

const TIMEOUT_MS = 60_000;

function failure(status: number, code: string, detail: string) {
  return NextResponse.json({ detail, code, params: {} }, { status });
}

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!isSameOriginRequest(request)) {
    return failure(403, "http.403", "Forbidden");
  }

  const segments = (await context.params).path;

  // Only the API's own routes, and no way to climb out of them.
  if (segments[0] !== "api" || segments.some((part) => part === ".." || part === "." || part === "")) {
    return failure(404, "http.404", "Not found.");
  }

  const token = request.cookies.get(sessionCookieName())?.value;

  if (!token) {
    return failure(401, "http.401", "You are not signed in.");
  }

  const headers = new Headers(visitorHeaders(request));

  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  headers.set("Authorization", `Bearer ${token}`);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const target = `${apiBase()}/${segments.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;

  let upstream: Response;

  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return failure(502, "http.503", "The service is not available right now.");
  }

  const responseHeaders = new Headers();

  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  const response = new NextResponse(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });

  // The API no longer accepts this token (expired, signed out elsewhere, account
  // deactivated). Drop the cookie so the next page load goes to the sign-in page.
  if (upstream.status === 401) {
    response.cookies.set(sessionCookieName(), "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE, forward as HEAD };
