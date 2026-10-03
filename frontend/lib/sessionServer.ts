/**
 * The staff session, on the server.
 *
 * The API token never reaches the browser's scripts. Signing in stores it in an
 * httpOnly cookie that only this app's server can read, and every API call goes
 * through app/api/backend, which attaches it. A script injected into a page
 * (XSS) can still make requests as the signed-in person while the page is
 * open, but it can no longer copy the token and use it from anywhere, later.
 *
 * Server only: nothing here may be imported into a client component.
 */

import type { NextRequest } from "next/server";

import { serverRuntimeConfig } from "@/lib/runtimeConfig";

/** The session cookie. Over https it is host-locked (__Host-): no Domain, path "/", Secure. */
export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-staff_session" : "staff_session";
}

export function apiBase(): string {
  return serverRuntimeConfig().apiUrl;
}

const ONE_DAY = 24 * 3600;

/**
 * How long the cookie should live: until the token inside it expires, so the
 * browser drops it at the same moment the API stops accepting it. The token is
 * only read here, not verified: the API does that on every call.
 */
export function sessionMaxAge(token: string, now: number = Date.now() / 1000): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

    if (typeof payload.exp === "number") {
      return Math.max(0, Math.floor(payload.exp - now));
    }
  } catch {
    // Not a token we can read; fall through to the default.
  }

  return ONE_DAY;
}

/**
 * The visitor's address as this app's own ingress saw it: the last
 * X-Forwarded-For entry is the one the platform vouches for; the rest were
 * written by the client.
 */
export function visitorIp(request: Request): string {
  const entries = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return entries[entries.length - 1] ?? "";
}

/**
 * Headers that let the API count the visitor, not this server, in its per-address
 * limits. The API only believes them when the shared secret matches
 * (TRUSTED_PROXY_SECRET on both sides); without it the platform's address,
 * which is this server's, is used.
 */
export function visitorHeaders(request: Request): Record<string, string> {
  const secret = process.env.TRUSTED_PROXY_SECRET;
  const ip = visitorIp(request);

  if (!secret || !ip) return {};

  return { "X-Proxy-Secret": secret, "X-Visitor-IP": ip };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request that changes something came from this app's own pages. The
 * cookie is SameSite=Lax, which already keeps it off cross-site POSTs; this is
 * the second lock. Browsers always say where a request came from, so one that
 * says nothing is not a browser acting for a signed-in person.
 */
export function isSameOriginRequest(request: Request | NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;

  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite) return fetchSite === "same-origin";

  const origin = request.headers.get("origin");

  if (!origin) return false;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
