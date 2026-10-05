import { NextResponse, type NextRequest } from "next/server";

import { marketingCsp, marketingCspHeader } from "@shared/csp";
import { DEFAULT_LANGUAGE, isLanguage } from "@shared/languages";

import { ENABLED_LANGUAGES } from "@/content/launch";

// English lives at "/", not "/en": an unprefixed path is rewritten to the
// default language's route. A language that is not enabled yet is treated like
// any unknown path (it falls through to the 404 page). An explicit "/en/..." is
// redirected to the unprefixed address, so every page has one canonical URL.
// There is deliberately no Accept-Language redirect.
//
// Every page response also carries the Content-Security-Policy (shared/csp.ts),
// report-only until a deployment sets CSP_ENFORCE=true.
function withPolicy(response: NextResponse): NextResponse {
  response.headers.set(
    marketingCspHeader(process.env.CSP_ENFORCE === "true"),
    marketingCsp(process.env.NODE_ENV !== "production"),
  );

  return response;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split("/")[1] ?? "";

  if (isLanguage(first)) {
    if (first === DEFAULT_LANGUAGE) {
      const url = request.nextUrl.clone();
      url.pathname = pathname.slice(`/${first}`.length) || "/";
      url.search = search;

      return withPolicy(NextResponse.redirect(url, 308));
    }

    // "/it" and "/pl": served as themselves once enabled. Until then the path
    // is rewritten below like any other, to "/en/it", which has no page: a 404.
    if ((ENABLED_LANGUAGES as readonly string[]).includes(first)) return withPolicy(NextResponse.next());
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LANGUAGE}${pathname === "/" ? "" : pathname}`;

  return withPolicy(NextResponse.rewrite(url));
}

export const config = {
  // Pages only: not build output, route handlers, the health check, files, or the
  // generated share image (served from its own address, which is already final).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|health|api/|.*opengraph-image.*|.*\\.(?:jpg|jpeg|png|webp|avif|svg|ico|txt|xml)$).*)"],
};
