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
        if (!cancelled) setError("Failed to load revenue.");
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
        title="Revenue"
        description="Revenue from completed reservations, attributed to their pickup date."
        actions={
          revenue && (
            <Button variant="secondary" onClick={() => downloadRevenueCsv(revenue)}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Download CSV
            </Button>
          )
        }
      />

      <Toolbar>
        <Field label="From">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          )}
        </Field>

        <Field label="To">
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
                label="Total revenue"
                value={formatCurrency(revenue.total_revenue)}
              />
              <StatTile label="From" value={formatDate(revenue.start_date)} />
              <StatTile label="To" value={formatDate(revenue.end_date)} />
            </StatTileGrid>

            <Card>
              <h2 className="text-lg font-semibold">Revenue over time</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Day-rate x duration of completed rentals, attributed to
                pickup date. Excludes surcharges and add-ons.
              </p>

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

            <h2 className="mb-4 mt-8 text-lg font-semibold text-ink">
              Money collected
            </h2>

            <StatTileGrid columns={4} className="mb-6">
              <StatTile
                label="Total collected"
                value={formatCurrency(revenue.total_collected)}
              />
              <StatTile
                label="By card"
                value={formatCurrency(revenue.collected_by_method.card)}
              />
              <StatTile
                label="By cash"
                value={formatCurrency(revenue.collected_by_method.cash)}
              />
              <StatTile
                label="Total refunded"
                value={formatCurrency(revenue.total_refunded)}
              />
            </StatTileGrid>

            <Card>
              <h2 className="text-lg font-semibold">Collected over time</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Money actually taken (card and cash), attributed to payment
                date. Includes surcharges and add-ons, excludes anything
                later refunded.
              </p>

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
