import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as signOut, POST as signIn } from "@/app/api/session/route";
import { GET as forwardGet, POST as forwardPost } from "@/app/api/backend/[...path]/route";
import { isBlocked, recordFailure, resetLoginBudget } from "@/lib/loginBudget";
import {
  isSameOriginRequest,
  sessionCookieName,
  sessionMaxAge,
  visitorHeaders,
  visitorIp,
} from "@/lib/sessionServer";

const SAME_SITE = { "sec-fetch-site": "same-origin" };

function token(exp: number): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${part({ alg: "HS256" })}.${part({ sub: "u1", exp })}.signature`;
}

function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new NextRequest(`http://localhost:3000${url}`, init);
}

function withSession(headers: Record<string, string> = {}) {
  return { cookie: `${sessionCookieName()}=the-token`, ...headers };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("TRUSTED_PROXY_SECRET", "");
  resetLoginBudget();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the session cookie's lifetime", () => {
  it("lasts exactly as long as the token inside it", () => {
    expect(sessionMaxAge(token(1_000_600), 1_000_000)).toBe(600);
  });

  it("is never negative, and falls back to a day for a token it cannot read", () => {
    expect(sessionMaxAge(token(10), 1_000_000)).toBe(0);
    expect(sessionMaxAge("not-a-token")).toBe(24 * 3600);
  });
});

describe("the visitor's address", () => {
  it("is the last forwarded entry, which the platform wrote", () => {
    const headers = { "x-forwarded-for": "6.6.6.6, 203.0.113.7" };

    expect(visitorIp(request("/", { headers }))).toBe("203.0.113.7");
  });

  it("is passed to the API only when the shared secret is set", () => {
    const asked = request("/", { headers: { "x-forwarded-for": "203.0.113.7" } });

    expect(visitorHeaders(asked)).toEqual({});

    vi.stubEnv("TRUSTED_PROXY_SECRET", "shared");

    expect(visitorHeaders(asked)).toEqual({ "X-Proxy-Secret": "shared", "X-Visitor-IP": "203.0.113.7" });
  });
});

describe("telling this app's own pages from other sites", () => {
  it("lets reads through and refuses a change that does not say where it came from", () => {
    expect(isSameOriginRequest(request("/", { method: "GET" }))).toBe(true);
    expect(isSameOriginRequest(request("/", { method: "POST" }))).toBe(false);
  });

  it("trusts the browser's own statement of where a request came from", () => {
    expect(isSameOriginRequest(request("/", { method: "POST", headers: SAME_SITE }))).toBe(true);
    expect(isSameOriginRequest(request("/", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
    expect(isSameOriginRequest(request("/", { method: "POST", headers: { "sec-fetch-site": "same-site" } }))).toBe(false);
  });

  it("falls back to comparing the Origin header with the host", () => {
    const post = (origin: string) =>
      request("/", { method: "POST", headers: { origin, host: "staff.example.com" } });

    expect(isSameOriginRequest(post("https://staff.example.com"))).toBe(true);
    expect(isSameOriginRequest(post("https://evil.example.com"))).toBe(false);
    expect(isSameOriginRequest(post("not a url"))).toBe(false);
  });
});

describe("the sign-in budget", () => {
  it("stops one visitor after ten wrong attempts without touching anyone else", () => {
    for (let i = 0; i < 10; i += 1) recordFailure("1.1.1.1");

    expect(isBlocked("1.1.1.1")).toBe(true);
    expect(isBlocked("2.2.2.2")).toBe(false);
  });

  it("forgives them after fifteen minutes", () => {
    for (let i = 0; i < 10; i += 1) recordFailure("1.1.1.1", 0);

    expect(isBlocked("1.1.1.1", 14 * 60 * 1000)).toBe(true);
    expect(isBlocked("1.1.1.1", 16 * 60 * 1000)).toBe(false);
  });

  it("never blocks a visitor whose address is unknown, since that would block everyone", () => {
    for (let i = 0; i < 50; i += 1) recordFailure("");

    expect(isBlocked("")).toBe(false);
  });
});

describe("signing in", () => {
  const login = (headers: Record<string, string> = SAME_SITE) =>
    request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
      body: JSON.stringify({ email: "a@b.co", password: "secret-password" }),
    });

  it("keeps the token in an httpOnly cookie and out of the response", async () => {
    const api = token(Math.floor(Date.now() / 1000) + 3600);
    fetchMock.mockResolvedValue(Response.json({ access_token: api, token_type: "bearer" }));

    const response = await signIn(login());
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain(api);

    const cookie = response.headers.get("set-cookie") ?? "";

    expect(cookie).toContain(`${sessionCookieName()}=${api}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie.toLowerCase()).toMatch(/max-age=3[56]\d\d/);
  });

  it("passes the API's refusal straight through, and sets no cookie", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ detail: "Incorrect", code: "auth.invalid_credentials", params: {} }, { status: 401 }),
    );

    const response = await signIn(login());

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("auth.invalid_credentials");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps a lockout's Retry-After", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: "auth.too_many_attempts" }, { status: 429, headers: { "Retry-After": "900" } }),
    );

    expect((await signIn(login())).headers.get("retry-after")).toBe("900");
  });

  it("stops forwarding a visitor's guesses once they have used their attempts", async () => {
    fetchMock.mockResolvedValue(Response.json({ code: "auth.invalid_credentials" }, { status: 401 }));

    for (let i = 0; i < 10; i += 1) await signIn(login());

    fetchMock.mockClear();
    const response = await signIn(login());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a sign-in that came from another site", async () => {
    const response = await signIn(login({ "sec-fetch-site": "cross-site" }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells the API who the visitor is when it shares the secret", async () => {
    vi.stubEnv("TRUSTED_PROXY_SECRET", "shared");
    fetchMock.mockResolvedValue(Response.json({ access_token: token(Date.now()) }));

    await signIn(login());

    const sent = new Headers(fetchMock.mock.calls[0][1].headers);

    expect(sent.get("x-visitor-ip")).toBe("203.0.113.7");
    expect(sent.get("x-proxy-secret")).toBe("shared");
  });
});

describe("signing out", () => {
  it("ends the session on the API and clears the cookie", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const response = await signOut(request("/api/session", { method: "DELETE", headers: withSession(SAME_SITE) }));

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(`${sessionCookieName()}=;`);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/auth/logout");
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization")).toBe("Bearer the-token");
  });

  it("still clears the cookie when the API cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("down"));

    const response = await signOut(request("/api/session", { method: "DELETE", headers: withSession(SAME_SITE) }));

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(`${sessionCookieName()}=;`);
  });
});

describe("forwarding a call to the API", () => {
  const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });

  it("adds the token from the cookie and passes the answer back", async () => {
    fetchMock.mockResolvedValue(
      Response.json([{ id: 1 }], { headers: { "content-disposition": 'attachment; filename="a.pdf"', "set-cookie": "x=1" } }),
    );

    const response = await forwardGet(
      request("/api/backend/api/cars?status=AVAILABLE", { headers: withSession() }),
      context("api", "cars"),
    );

    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/cars?status=AVAILABLE");
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization")).toBe("Bearer the-token");
    expect(await response.json()).toEqual([{ id: 1 }]);
    expect(response.headers.get("content-disposition")).toContain("a.pdf");
    // Only what is listed comes back; the API cannot set cookies on this app.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not pass the browser's own cookies or headers on to the API", async () => {
    fetchMock.mockResolvedValue(Response.json({}));

    await forwardGet(
      request("/api/backend/api/cars", { headers: withSession({ "x-anything": "else", authorization: "Bearer forged" }) }),
      context("api", "cars"),
    );

    const sent = new Headers(fetchMock.mock.calls[0][1].headers);

    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("x-anything")).toBeNull();
    expect(sent.get("authorization")).toBe("Bearer the-token");
  });

  it("sends a body along", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }, { status: 201 }));

    const response = await forwardPost(
      request("/api/backend/api/reservations", {
        method: "POST",
        headers: withSession({ ...SAME_SITE, "content-type": "application/json" }),
        body: JSON.stringify({ a: 1 }),
      }),
      context("api", "reservations"),
    );

    expect(response.status).toBe(201);
    expect(Buffer.from(fetchMock.mock.calls[0][1].body).toString()).toBe('{"a":1}');
  });

  it("answers 401 without calling the API when there is no session", async () => {
    const response = await forwardGet(request("/api/backend/api/cars"), context("api", "cars"));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets the sign-in page read the business's branding without a session, and nothing else", async () => {
    fetchMock.mockResolvedValue(Response.json({ business_name: "Island Cars" }));

    const branding = await forwardGet(request("/api/backend/api/branding"), context("api", "branding"));

    expect(branding.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/branding");
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization")).toBeNull();

    fetchMock.mockClear();

    // Not a route that merely starts the same way, and not a change to branding.
    const lookalike = await forwardGet(request("/api/backend/api/brandings"), context("api", "brandings"));
    const change = await forwardPost(
      request("/api/backend/api/branding", { method: "POST", headers: SAME_SITE, body: "{}" }),
      context("api", "branding"),
    );

    expect(lookalike.status).toBe(401);
    expect(change.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops the cookie once the API says the session is over", async () => {
    fetchMock.mockResolvedValue(Response.json({ code: "http.401" }, { status: 401 }));

    const response = await forwardGet(request("/api/backend/api/cars", { headers: withSession() }), context("api", "cars"));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain(`${sessionCookieName()}=;`);
  });

  it("refuses a change that came from another site, and never reaches the API", async () => {
    const attempts: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, {}];

    for (const headers of attempts) {
      const response = await forwardPost(
        request("/api/backend/api/users", { method: "POST", headers: withSession(headers), body: "{}" }),
        context("api", "users"),
      );

      expect(response.status).toBe(403);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only forwards to the API's own routes, and cannot climb out of them", async () => {
    for (const path of [["health"], ["api", "..", "admin"], ["api", ""], ["..", "etc"]]) {
      const response = await forwardGet(request("/api/backend/x", { headers: withSession() }), context(...path));

      expect(response.status).toBe(404);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers for itself when the API cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("down"));

    const response = await forwardGet(request("/api/backend/api/cars", { headers: withSession() }), context("api", "cars"));

    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("http.503");
  });
});
