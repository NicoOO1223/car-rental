"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { downloadRevenueCsv, getRevenue, type Revenue } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { Toolbar } from "@/components/ui/Toolbar";
import { LineChart } from "@/components/charts/LineChart";
import { formatCurrency, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

export default function RevenuePage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadRevenue() {
      setLoading(true);
      setError("");

      try {
        const data = await getRevenue({
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });

        if (!cancelled) setRevenue(data);
      } catch {
        if (!cancelled) setError(t("s.admin.revenue.failedLoadRevenue"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRevenue();

    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  return (
    <PageShell>
      <PageHeader
        title={t("s.admin.revenue.revenue")}
        description={t("s.admin.revenue.revenueFromCompletedReservations")}
        actions={
          revenue && (
            <Button variant="secondary" onClick={() => downloadRevenueCsv(revenue)}>
              <Download className="h-4 w-4" aria-hidden="true" />{t("s.admin.revenue.downloadCsv")}</Button>
          )
        }
      />

      <Toolbar>
        <Field label={t("s.admin.revenue.from")}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          )}
        </Field>

        <Field label={t("s.admin.revenue.text")}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          )}
        </Field>
      </Toolbar>

      {error && (
        <Card className="mb-6">
          <p className="text-red-600" role="alert">
            {error}
          </p>
        </Card>
      )}

      {loading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : (
        revenue && (
          <>
            <StatTileGrid columns={3} className="mb-6">
              <StatTile
                label={t("s.admin.revenue.totalRevenue")}
                value={formatCurrency(revenue.total_revenue)}
              />
              <StatTile label={t("s.admin.revenue.from")} value={formatDate(revenue.start_date)} />
              <StatTile label={t("s.admin.revenue.text")} value={formatDate(revenue.end_date)} />
            </StatTileGrid>

            <Card>
              <h2 className="text-lg font-semibold">{t("s.admin.revenue.revenueOverTime")}</h2>
              <p className="mt-1 text-sm text-ink-muted">{t("s.admin.revenue.dayRateXDuration")}</p>

              <div className="mt-6">
                <LineChart
                  data={revenue.points.map((point) => ({
                    date: point.date,
                    value: point.revenue,
                  }))}
                  formatValue={formatCurrency}
                />
              </div>
            </Card>

            <h2 className="mb-4 mt-8 text-lg font-semibold text-ink">{t("s.admin.revenue.moneyCollected")}</h2>

            <StatTileGrid columns={4} className="mb-6">
              <StatTile
                label={t("s.admin.revenue.totalCollected")}
                value={formatCurrency(revenue.total_collected)}
              />
              <StatTile
                label={t("s.admin.revenue.byCard")}
                value={formatCurrency(revenue.collected_by_method.card)}
              />
              <StatTile
                label={t("s.admin.revenue.byCash")}
                value={formatCurrency(revenue.collected_by_method.cash)}
              />
              <StatTile
                label={t("s.admin.revenue.totalRefunded")}
                value={formatCurrency(revenue.total_refunded)}
              />
            </StatTileGrid>

            <Card>
              <h2 className="text-lg font-semibold">{t("s.admin.revenue.collectedOverTime")}</h2>
              <p className="mt-1 text-sm text-ink-muted">{t("s.admin.revenue.moneyActuallyTakenCard")}</p>

              <div className="mt-6">
                <LineChart
                  data={revenue.collected_points.map((point) => ({
                    date: point.date,
                    value: point.revenue,
                  }))}
                  formatValue={formatCurrency}
                />
              </div>
            </Card>
          </>
        )
      )}
    </PageShell>
  );
}
