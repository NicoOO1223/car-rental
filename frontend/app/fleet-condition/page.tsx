"use client";

import { useEffect, useState } from "react";
import { Gauge, ShieldCheck } from "lucide-react";

import { getFleetCondition, type CarCondition } from "@/lib/api";
import { DataTable, TwoLine, type Column } from "@/components/ui/DataTable";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import { StatTile, StatTileGrid } from "@/components/ui/StatTile";
import { formatCurrency, formatDate } from "@/lib/format";
import { useNavigate } from "@/lib/useNavigate";
import { enumLabel, t } from "@/lib/i18n";

function insuranceDaysLeft(insuredUntil: string): number {
  const [year, month, day] = insuredUntil.split("-").map(Number);
  const due = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function AlertBadges({ car }: { car: CarCondition }) {
  const badges: { key: string; label: string; tone: string }[] = [];

  if (car.oil_change_overdue) {
    badges.push({ key: "oil", label: t("s.fleetCondition.oilOverdue"), tone: "bg-amber-100 text-amber-800" });
  }

  if (car.condition_review_overdue) {
    badges.push({
      key: "condition",
      label: t("s.fleetCondition.conditionReviewOverdue"),
      tone: "bg-amber-100 text-amber-800",
    });
  }

  if (car.next_inspection_due) {
    const days = insuranceDaysLeft(car.next_inspection_due);
    if (days < 0) badges.push({ key: "inspection", label: t("s.cars.id.overdue"), tone: "bg-red-100 text-red-700" });
    else if (days <= 30) badges.push({ key: "inspection", label: t("s.cars.id.dueSoon"), tone: "bg-amber-100 text-amber-800" });
  }

  if (car.insured_until) {
    const days = insuranceDaysLeft(car.insured_until);
    if (days < 0) badges.push({ key: "insurance", label: t("s.cars.id.expired"), tone: "bg-red-100 text-red-700" });
    else if (days <= 30) badges.push({ key: "insurance", label: t("s.cars.id.endsSoon"), tone: "bg-amber-100 text-amber-800" });
  }

  if (badges.length === 0) {
    return <span className="text-sm text-ink-muted">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span key={badge.key} className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.tone}`}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

export default function FleetConditionPage() {
  const navigate = useNavigate();

  const [cars, setCars] = useState<CarCondition[]>([]);
  const [insurance, setInsurance] = useState<CarCondition[]>([]);
  const [totals, setTotals] = useState({ insurance: "0", maintenance: "0" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getFleetCondition()
      .then((data) => {
        if (cancelled) return;
        setCars(data.cars);
        setInsurance(data.insurance);
        setTotals({ insurance: data.total_insurance_cost, maintenance: data.total_maintenance_spend });
      })
      .catch(() => {
        if (!cancelled) setError(t("s.fleetCondition.failedLoad"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const columns: Column<CarCondition>[] = [
    {
      id: "vehicle",
      header: t("s.fleetCondition.vehicle"),
      mobile: "primary",
      cell: (car) => <TwoLine primary={`${car.make} ${car.model}`} secondary={car.license_plate} />,
      mobileCell: (car) => `${car.make} ${car.model}`,
    },
    {
      id: "mileage",
      header: t("s.fleetCondition.mileage"),
      cell: (car) => (
        <span className="text-sm text-ink-muted">
          {car.mileage != null ? t("common.km", { value: car.mileage }) : "—"}
        </span>
      ),
    },
    {
      id: "tireCondition",
      header: t("s.fleetCondition.tireCondition"),
      cell: (car) => (
        <span className="text-sm text-ink-muted">
          {car.tire_condition ? enumLabel("tireCondition", car.tire_condition) : "—"}
        </span>
      ),
    },
    {
      id: "oilChange",
      header: t("s.fleetCondition.lastOilChange"),
      cell: (car) => (
        <div className="text-sm text-ink-muted">
          <div>{car.last_oil_change_at ? formatDate(car.last_oil_change_at) : "—"}</div>
          {car.last_oil_change_mileage != null && (
            <div className="mt-0.5">{t("s.fleetCondition.atMileage", { mileage: car.last_oil_change_mileage })}</div>
          )}
        </div>
      ),
    },
    {
      id: "inspection",
      header: t("s.fleetCondition.nextInspection"),
      cell: (car) => (
        <span className="text-sm text-ink-muted">
          {car.next_inspection_due ? formatDate(car.next_inspection_due) : "—"}
        </span>
      ),
    },
    {
      id: "alerts",
      header: t("s.fleetCondition.alerts"),
      mobile: "trailing",
      cell: (car) => <AlertBadges car={car} />,
    },
  ];

  const insuranceColumns: Column<CarCondition>[] = [
    {
      id: "vehicle",
      header: t("s.fleetCondition.vehicle"),
      mobile: "primary",
      cell: (car) => <TwoLine primary={`${car.make} ${car.model}`} secondary={car.license_plate} />,
      mobileCell: (car) => `${car.make} ${car.model}`,
    },
    {
      id: "insuredUntil",
      header: t("s.fleetCondition.insuredUntil"),
      cell: (car) => (
        <span className="text-sm text-ink-muted">
          {car.insured_until ? formatDate(car.insured_until) : "—"}
        </span>
      ),
    },
    {
      id: "daysRemaining",
      header: t("s.fleetCondition.daysRemaining"),
      cell: (car) => {
        if (!car.insured_until) return <span className="text-sm text-ink-muted">—</span>;
        const days = insuranceDaysLeft(car.insured_until);
        const tone = days < 0 ? "text-red-700" : days <= 30 ? "text-amber-800" : "text-ink-muted";
        return <span className={`text-sm font-medium ${tone}`}>{days}</span>;
      },
    },
    {
      id: "cost",
      header: t("s.fleetCondition.cost"),
      mobile: "trailing",
      cell: (car) => (
        <span className="text-sm text-ink-muted">
          {car.insurance_cost != null ? formatCurrency(car.insurance_cost) : "—"}
        </span>
      ),
    },
  ];

  return (
    <PageShell width="wide">
      <PageHeader
        title={t("s.fleetCondition.title")}
        description={t("s.fleetCondition.description")}
      />

      {error && (
        <div className="mb-6 rounded-xl bg-surface p-6 shadow-sm">
          <p className="text-red-600" role="alert">
            {error}
          </p>
        </div>
      )}

      <StatTileGrid columns={2} className="mb-6">
        <StatTile
          label={t("s.fleetCondition.totalInsuranceCost")}
          value={formatCurrency(totals.insurance)}
          icon={ShieldCheck}
        />
        <StatTile
          label={t("s.fleetCondition.totalMaintenanceSpend")}
          value={formatCurrency(totals.maintenance)}
          icon={Gauge}
        />
      </StatTileGrid>

      <DataTable
        rows={cars}
        columns={columns}
        rowKey={(car) => car.id}
        loading={loading}
        onRowClick={(car) => navigate(`/cars/${car.id}`)}
        empty={{
          icon: Gauge,
          title: t("s.fleetCondition.noVehicles"),
        }}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold text-ink">{t("s.fleetCondition.insurance")}</h2>

      <DataTable
        rows={insurance}
        columns={insuranceColumns}
        rowKey={(car) => car.id}
        loading={loading}
        onRowClick={(car) => navigate(`/cars/${car.id}`)}
        empty={{
          icon: ShieldCheck,
          title: t("s.fleetCondition.noVehicles"),
        }}
      />
    </PageShell>
  );
}
