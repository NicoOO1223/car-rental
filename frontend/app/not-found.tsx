import Link from "next/link";
import { Compass } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageShell } from "@/components/ui/PageHeader";
import { t } from "@/lib/i18n";

/** Shown for any address that does not exist, inside the app's own layout. */
export default function NotFound() {
  return (
    <PageShell width="narrow">
      <EmptyState
        icon={Compass}
        title={t("errorPages.notFoundTitle")}
        description={t("errorPages.notFoundDescription")}
        action={
          <Link
            href="/"
            className="text-sm font-medium text-ink-secondary underline hover:text-ink"
          >
            {t("errorPages.backToOverview")}
          </Link>
        }
      />
    </PageShell>
  );
}
