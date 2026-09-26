import { NextResponse } from "next/server";

import { contentSecurityPolicy } from "@/lib/csp";

// Runs on every page request so the policy names this stack's own API, read
// from the container's environment when the request arrives. The other
// security headers do not vary by stack and stay in next.config.ts.
export function proxy() {
  const response = NextResponse.next();

  response.headers.set("Content-Security-Policy-Report-Only", contentSecurityPolicy());

  return response;
}

export const config = {
  // Pages only: not build output, images or the icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
