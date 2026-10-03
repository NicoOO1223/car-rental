import { NextResponse, type NextRequest } from "next/server";

import { storefrontCsp } from "@shared/csp";
import { DEFAULT_LANGUAGE, isLanguage, negotiateLanguage } from "@shared/languages";

import { runtimeConfig } from "@/lib/runtime";

export const LANGUAGE_COOKIE = "storefront_language";

// Runs on every page request. It sends a visitor to the address in their
// language (the one they last chose, else the one their browser asks for) and
// sets a policy that names this stack own API, read from the container
// environment when the request arrives.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split("/")[1] ?? "";

  let response: NextResponse;

  if (isLanguage(first)) {
    response = NextResponse.next();
  } else {
    const remembered = request.cookies.get(LANGUAGE_COOKIE)?.value;
    const language = isLanguage(remembered)
      ? remembered
      : negotiateLanguage(request.headers.get("accept-language"), DEFAULT_LANGUAGE);

    const url = request.nextUrl.clone();
    url.pathname = `/${language}${pathname === "/" ? "" : pathname}`;
    url.search = search;

    response = NextResponse.redirect(url);
  }

  // Report-only first: the browser logs what the policy would block without
  // breaking anything, until it has run clean on a real stack.
  response.headers.set(
    "Content-Security-Policy-Report-Only",
    storefrontCsp(runtimeConfig(), process.env.NODE_ENV !== "production"),
  );

  return response;
}

export const config = {
  // Pages only: not build output, route handlers, the health check, the
  // icon or the images in public/.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|health|api/|.*\\.(?:jpg|jpeg|png|webp|avif|svg|ico)$).*)"],
};
