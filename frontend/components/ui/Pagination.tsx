import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { t } from "@/lib/i18n";

/**
 * Server-side page controls, for lists too large to load in full (the
 * pattern every other list page uses instead — see DataTable's own
 * comment). DataTable's sorting only ever sees the current page's rows,
 * so pages using this should leave every column unsortable.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
      <p>{total === 0 ? t("ui.pagination.noResults") : t("ui.pagination.showing", { start, end, total })}</p>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t("ui.pagination.previous")}
        </Button>

        <span className="tabular-nums">
          {t("ui.pagination.page", { page, pages: pageCount })}
        </span>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
        >
          {t("ui.pagination.next")}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
