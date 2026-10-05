import { NextResponse } from "next/server";

import { formSecret, turnstileConfig } from "@/lib/demoConfig";
import { createFormToken } from "@/lib/formToken";

// Called when the form opens: a signed timestamp (so the server can tell how long
// the form was on screen) and the Turnstile site key, which is a deployment
// setting and so cannot be baked into the prerendered page.

export const dynamic = "force-dynamic";

export function GET() {
  const secret = formSecret();

  return NextResponse.json(
    { token: secret ? createFormToken(Date.now(), secret) : "", siteKey: turnstileConfig().siteKey },
    { headers: { "Cache-Control": "no-store" } },
  );
}
