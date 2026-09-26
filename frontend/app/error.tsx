"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageShell } from "@/components/ui/PageHeader";
import { t } from "@/lib/i18n";

/**
 * A page that crashed while rendering. The rest of the app (sidebar, other
 * pages) keeps working, and the person can try again without a reload.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <PageShell width="narrow">
      <EmptyState
        icon={TriangleAlert}
        title={t("errorPages.errorTitle")}
        description={t("errorPages.errorDescription")}
        action={<Button onClick={() => reset()}>{t("errorPages.tryAgain")}</Button>}
      />
    </PageShell>
  );
}
