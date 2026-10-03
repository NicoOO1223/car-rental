import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy, cspHeaderName } from "@/lib/csp";
import { sessionCookieName } from "@/lib/sessionServer";

// Runs on every page request. It sends someone with no session to the sign-in
// page before any page is rendered (the cookie is httpOnly, so the page's own
// scripts cannot tell, and used to have to guess), and it sets the content
// security policy, which names this stack's own API and so is read from the
// container's environment when the request arrives. The other security headers
// do not vary by stack and stay in next.config.ts.
//
// This is a convenience, not the lock: the API checks the token on every call.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /api/* answers for itself (401 JSON, not a redirect); a file with an
  // extension is a static asset (icons, images), which the sign-in page uses.
  const needsSession = pathname !== "/login" && !pathname.startsWith("/api/") && !/\.[a-z0-9]+$/i.test(pathname);

  if (needsSession && !request.cookies.has(sessionCookieName())) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.next();

  response.headers.set(cspHeaderName(), contentSecurityPolicy());

  return response;
}

export const config = {
  // Pages only: not build output, images or the icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
