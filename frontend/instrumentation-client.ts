import * as Sentry from "@sentry/nextjs";

import { getRuntimeConfig } from "@/lib/runtimeConfig";

const dsn = getRuntimeConfig().sentryDsn;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
