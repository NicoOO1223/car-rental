import { NextResponse } from "next/server";

import { brand } from "@/content/brand";
import { clientIp } from "@/lib/clientIp";
import { formSecret, notifyAddress, turnstileConfig } from "@/lib/demoConfig";
import { MAX_BODY_BYTES, processDemoRequest } from "@/lib/demoRequest";
import { getTranslator } from "@/lib/i18n";
import { createMailer } from "@/lib/mailer";
import { demoLimiter } from "@/lib/rateLimit";
import { verifyTurnstile } from "@/lib/turnstile";

// The only way anything is written on this site: it sends two emails and stores nothing.
// All decisions are in lib/demoRequest.ts; this gathers what it needs and answers.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);

  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const ip = clientIp(request.headers);
  const turnstile = turnstileConfig();

  const result = await processDemoRequest(
    {
      contentType: request.headers.get("content-type"),
      bodyText: await request.text(),
      origin: request.headers.get("origin"),
      host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
      ip,
    },
    {
      now: Date.now,
      limiter: demoLimiter,
      mailer: createMailer(process.env),
      verifyHuman: turnstile.secret
        ? (token, address) => verifyTurnstile({ token, ip: address, secret: turnstile.secret as string })
        : null,
      allowNoTurnstile: turnstile.allowNone,
      formSecret: formSecret(),
      notifyAddress: notifyAddress(),
      brandName: brand.name,
      t: getTranslator("en"),
      log: (message) => console.log(message),
    },
  );

  const headers: Record<string, string> = { "Cache-Control": "no-store" };

  if (result.status === 429) headers["Retry-After"] = String(result.body.retryAfter);

  return NextResponse.json(result.body, { status: result.status, headers });
}
